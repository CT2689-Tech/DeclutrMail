import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { HomeVisitSummary } from '@declutrmail/shared/contracts/home-visit';
import { pluralCopy, WS2_COPY } from '@declutrmail/shared/copy/launch';

import { HomeArrivalsView } from './home-arrivals';
import { formatCount, HOME_DECK } from './home-deck-copy';

const sinceLast = WS2_COPY.liveFix.home.sinceLast;
const homeDir = dirname(fileURLToPath(import.meta.url));

/**
 * Stage ids are lookup keys. The sentence Home shows is the value, and
 * that value is checked on its own below.
 */
const INTERNAL_IDS = new Set(['building_sender_index']);

const visit: HomeVisitSummary = {
  visitId: '10000000-0000-4000-8000-000000000001',
  since: '2026-10-09T10:00:00.000Z',
  until: '2026-10-10T10:00:00.000Z',
  indexedEmails: 142,
  indexedSenders: 3,
};

function sinceLastCount(forms: { readonly one: string; readonly other: string }, count: number) {
  return pluralCopy(forms, count, { n: formatCount(count) });
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(path);
  }
  return found;
}

function stringLiterals(source: string): string[] {
  const found: string[] = [];
  const pattern = /(?:`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g;
  for (const match of source.matchAll(pattern)) found.push(match[0].slice(1, -1));
  return found;
}

/**
 * Text outside same-line `{...}` expressions. `indexed` is copy.
 * `indexedEmails` and `building_sender_index` stay identifiers.
 */
function visibleLine(line: string): string {
  let out = '';
  let depth = 0;
  let quote: "'" | '"' | '`' | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] ?? '';
    if (quote !== null) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      if (depth === 0) out += ch;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      if (depth === 0) out += ch;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) out += ch;
  }
  return out;
}

const INDEX_WORD = /(?<![A-Za-z0-9_])index(?:ed|ing)?(?![A-Za-z0-9_])/i;

function renderedCopy(root: HTMLElement): string[] {
  const texts: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const text = current.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (text) texts.push(text);
    current = walker.nextNode();
  }
  for (const element of root.querySelectorAll<HTMLElement>(
    '[aria-label],[title],[alt],[placeholder]',
  )) {
    for (const name of ['aria-label', 'title', 'alt', 'placeholder']) {
      const value = element.getAttribute(name);
      if (value) texts.push(value);
    }
  }
  return texts;
}

function deckStrings(value: unknown, found: string[]): void {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) for (const item of value) deckStrings(item, found);
  else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) deckStrings(item, found);
  }
}

describe('Home copy', () => {
  it('fails when a Home user-facing string contains index', () => {
    const hits: string[] = [];
    for (const file of sourceFiles(homeDir)) {
      const source = readFileSync(file, 'utf8');
      for (const literal of stringLiterals(source)) {
        if (!INDEX_WORD.test(literal) || INTERNAL_IDS.has(literal)) continue;
        hits.push(literal);
      }
      if (!file.endsWith('.tsx')) continue;
      for (const line of source.split('\n')) {
        const text = visibleLine(line);
        if (INDEX_WORD.test(text)) hits.push(text.trim());
      }
    }
    const bound: string[] = [];
    deckStrings(HOME_DECK, bound);
    deckStrings(sinceLast, bound);
    for (const literal of bound) {
      if (/index/i.test(literal)) hits.push(literal);
    }
    expect(HOME_DECK.syncingStage.building_sender_index.toLowerCase()).not.toContain('index');
    expect(hits).toEqual([]);
  });

  it('shows the locked since-last lines', () => {
    const { unmount } = render(
      <HomeArrivalsView data={visit} error={false} retry={() => undefined} />,
    );
    expect(screen.getByRole('region', { name: sinceLast.eyebrow })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: sinceLastCount(sinceLast.title, 142) }),
    ).toBeInTheDocument();
    expect(screen.getByText(sinceLastCount(sinceLast.senders, 3))).toBeInTheDocument();
    expect(screen.queryByText(/previous visit/)).toBeNull();
    expect(renderedCopy(document.body).some((text) => /index/i.test(text))).toBe(false);
    unmount();

    render(
      <HomeArrivalsView
        data={{ ...visit, indexedEmails: 1, indexedSenders: 1 }}
        error={false}
        retry={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: sinceLast.title.one })).toHaveTextContent(
      sinceLast.title.one,
    );
    expect(screen.getByText(sinceLast.senders.one)).toBeInTheDocument();
    expect(renderedCopy(document.body).some((text) => /index/i.test(text))).toBe(false);
  });

  it('uses the none line when no new email was scanned', () => {
    const { unmount } = render(
      <HomeArrivalsView
        data={{ ...visit, indexedEmails: 0, indexedSenders: 0 }}
        error={false}
        retry={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: sinceLast.none })).toHaveTextContent(sinceLast.none);
    expect(screen.queryByText(sinceLastCount(sinceLast.senders, 0))).toBeNull();
    expect(screen.queryByText(/previous visit/)).toBeNull();
    expect(renderedCopy(document.body).some((text) => /index/i.test(text))).toBe(false);
    unmount();

    render(
      <HomeArrivalsView
        data={{ ...visit, indexedEmails: 4, indexedSenders: 0 }}
        error={false}
        retry={() => undefined}
      />,
    );
    expect(
      screen.getByRole('heading', { name: sinceLastCount(sinceLast.title, 4) }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/sender/)).toBeNull();
  });
});
