#!/usr/bin/env tsx
/**
 * generate-impl-log.ts
 *
 * Parses the implementation plan and emits the 235-D row table into
 * IMPLEMENTATION-LOG.md.
 *
 * Plan source (CLAUDE.md §4 precedence):
 *   1. docs/execution/Implementation-Plan.md  (repo mirror)
 *   2. ~/.claude/plans/i-want-you-to-smooth-kahn.md  (local fallback)
 *
 * D-decision pattern in the plan: a heading line like
 *   `### D11 — Drizzle ORM setup`
 *   `### D11. Drizzle ORM setup`
 *   `**D11.** Drizzle ORM setup`
 *
 * Output: replaces the `<!-- AUTO:DECISIONS -->` block in
 * IMPLEMENTATION-LOG.md with one row per parsed D.
 *
 * Exit codes:
 *   0 — log updated (or already up to date)
 *   1 — plan not found at either location
 *   2 — IMPLEMENTATION-LOG.md missing the AUTO:DECISIONS markers
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname ?? __dirname, '..');
const LOG_PATH = join(REPO_ROOT, 'IMPLEMENTATION-LOG.md');
const MIRROR_PATH = join(REPO_ROOT, 'docs/execution/Implementation-Plan.md');
const LOCAL_PATH = join(homedir(), '.claude/plans/i-want-you-to-smooth-kahn.md');

const MARKER_START = '<!-- AUTO:DECISIONS:START -->';
const MARKER_END = '<!-- AUTO:DECISIONS:END -->';

interface Decision {
  num: number;
  title: string;
}

function resolvePlanPath(): string | null {
  if (existsSync(MIRROR_PATH)) return MIRROR_PATH;
  if (existsSync(LOCAL_PATH)) return LOCAL_PATH;
  return null;
}

function parseDecisions(plan: string): Decision[] {
  const seen = new Set<number>();
  const decisions: Decision[] = [];
  const lineRegex = /^(?:#{1,6}\s+|\*\*)D(\d{1,3})(?:\*\*)?\s*[—\-.:]\s*(.+?)(?:\s*\*\*)?$/gm;

  let match: RegExpExecArray | null;
  while ((match = lineRegex.exec(plan)) !== null) {
    const num = Number(match[1]);
    const title = match[2].trim().replace(/\s+/g, ' ');
    if (seen.has(num)) continue;
    seen.add(num);
    decisions.push({ num, title });
  }

  decisions.sort((a, b) => a.num - b.num);
  return decisions;
}

function renderRows(decisions: Decision[]): string {
  const lines = ['| D# | Title | Status | PR | Verified by | Notes |', '|---|---|---|---|---|---|'];
  for (const d of decisions) {
    lines.push(`| D${d.num} | ${d.title} | ⬜ |  |  |  |`);
  }
  return lines.join('\n');
}

function main(): void {
  const planPath = resolvePlanPath();
  if (!planPath) {
    console.error(`✗ Plan not found. Checked:\n  - ${MIRROR_PATH}\n  - ${LOCAL_PATH}`);
    process.exit(1);
  }

  const plan = readFileSync(planPath, 'utf8');
  const decisions = parseDecisions(plan);

  if (decisions.length === 0) {
    console.error(`✗ No D-decisions parsed from ${planPath}`);
    process.exit(1);
  }

  const log = readFileSync(LOG_PATH, 'utf8');
  const startIdx = log.indexOf(MARKER_START);
  const endIdx = log.indexOf(MARKER_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    console.error(`✗ ${LOG_PATH} missing markers ${MARKER_START} ... ${MARKER_END}`);
    process.exit(2);
  }

  const before = log.slice(0, startIdx + MARKER_START.length);
  const after = log.slice(endIdx);
  const next = `${before}\n\n${renderRows(decisions)}\n\n${after}`;

  writeFileSync(LOG_PATH, next);
  console.log(`✓ Wrote ${decisions.length} D-rows to ${LOG_PATH} from ${planPath}`);
}

main();
