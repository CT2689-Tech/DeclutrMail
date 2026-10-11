import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface GlossaryBan {
  id: string;
  pattern: string;
  flags: string;
  /** `all` runs everywhere. `report` runs only on report copy. */
  scope: 'all' | 'report';
}

export interface UiGlossary {
  allowedNames: readonly string[];
  banned: readonly GlossaryBan[];
  allowExact: ReadonlyArray<{ id: string; text: string }>;
  defs: Readonly<Record<string, string>>;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** Parse the constrained glossary YAML this package ships. */
export function parseUiGlossary(yaml: string): UiGlossary {
  const allowedNames: string[] = [];
  const banned: GlossaryBan[] = [];
  const allowExact: Array<{ id: string; text: string }> = [];
  const defs: Record<string, string> = {};
  let section: 'none' | 'allowed' | 'banned' | 'allow' | 'defs' = 'none';
  let current: Partial<GlossaryBan> & { text?: string } = {};

  const flushBan = () => {
    if (current.id && current.pattern) {
      banned.push({
        id: current.id,
        pattern: current.pattern,
        flags: current.flags ?? '',
        scope: current.scope === 'report' ? 'report' : 'all',
      });
    }
    current = {};
  };
  const flushAllow = () => {
    if (current.id && current.text) allowExact.push({ id: current.id, text: current.text });
    current = {};
  };

  for (const raw of yaml.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (line.length === 0 || line.startsWith('#')) continue;
    if (line === 'allowed_names:') {
      flushBan();
      section = 'allowed';
      continue;
    }
    if (line === 'banned:') {
      section = 'banned';
      continue;
    }
    if (line === 'allow_exact:') {
      flushBan();
      section = 'allow';
      continue;
    }
    if (line === 'defs:') {
      flushAllow();
      section = 'defs';
      continue;
    }
    if (section === 'allowed' && line.startsWith('  - ')) {
      allowedNames.push(unquote(line.slice(4).trim()));
      continue;
    }
    if ((section === 'banned' || section === 'allow') && line.startsWith('  - ')) {
      if (section === 'banned') flushBan();
      else flushAllow();
      const body = line.slice(4).trim();
      const [key, ...rest] = body.split(':');
      if (key) assign(current, key.trim(), rest.join(':').trim());
      continue;
    }
    if ((section === 'banned' || section === 'allow') && line.startsWith('    ')) {
      const body = line.trim();
      const [key, ...rest] = body.split(':');
      if (key) assign(current, key.trim(), rest.join(':').trim());
      continue;
    }
    if (section === 'defs') {
      const splitAt = line.indexOf(':');
      if (splitAt === -1) continue;
      const key = unquote(line.slice(0, splitAt).trim());
      defs[key] = unquote(line.slice(splitAt + 1).trim());
    }
  }
  if (section === 'banned') flushBan();
  if (section === 'allow') flushAllow();
  return { allowedNames, banned, allowExact, defs };
}

function assign(target: Partial<GlossaryBan> & { text?: string }, key: string, raw: string) {
  const value = unquote(raw);
  if (key === 'id') target.id = value;
  if (key === 'pattern') target.pattern = value;
  if (key === 'flags') target.flags = value;
  if (key === 'scope') target.scope = value === 'report' ? 'report' : 'all';
  if (key === 'text') target.text = value;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return JSON.parse(value.startsWith("'") ? JSON.stringify(value.slice(1, -1)) : value) as string;
  }
  return value;
}

export function loadUiGlossary(): UiGlossary {
  const yaml = readFileSync(join(HERE, 'ui-glossary.yaml'), 'utf8');
  return parseUiGlossary(yaml);
}

export interface GlossaryHit {
  id: string;
  text: string;
}

/**
 * Code tokens (routes, analytics names, enum values) are exempt.
 * A user-facing label has whitespace or a capital letter.
 */
export function isGlossaryExempt(text: string): boolean {
  return /^[a-z0-9_./:?&=[\]-]+$/.test(text);
}

export function glossaryHits(
  text: string,
  glossary: UiGlossary,
  scope: 'all' | 'report' = 'all',
): GlossaryHit[] {
  if (isGlossaryExempt(text)) return [];
  const hits: GlossaryHit[] = [];
  for (const ban of glossary.banned) {
    if (ban.scope === 'report' && scope !== 'report') continue;
    if (glossary.allowExact.some((entry) => entry.id === ban.id && entry.text === text)) continue;
    const flags = ban.flags.includes('g') ? ban.flags : `${ban.flags}g`;
    const re = new RegExp(ban.pattern, flags);
    if (re.test(text)) hits.push({ id: ban.id, text });
  }
  return hits;
}
