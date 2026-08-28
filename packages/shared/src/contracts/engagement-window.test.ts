import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ENGAGEMENT_WINDOW_DAYS,
  ENGAGEMENT_WINDOW_MS,
  engagementWindowStart,
} from './engagement-window';

/**
 * "The last 90 days" must have exactly one definition.
 *
 * It had four — the scorer, the activity read service, the triage read
 * service, and the action preview's SQL — and nothing held them equal. That
 * is what let one of them be changed in isolation with every check green
 * while the product contradicted itself on a single card: the scorer writes
 * "N% read rate over the last 90 days" into a triage row's reasoning text,
 * and the stat tile rendered directly above it came from a different window.
 *
 * This scan is the thing that would have failed. It is not about the number.
 */
const REPO = join(import.meta.dirname, '../../../..');

/** Files allowed to spell the window out, because they DEFINE it. */
const ALLOWED = ['packages/shared/src/contracts/engagement-window.ts'];

/**
 * SQL literals that still carry the interval inline. Left as-is on purpose:
 * they are `now() - interval '90 days'` inside raw fragments, where binding a
 * JS value changes the query plan and the risk outweighs the tidiness. Listed
 * rather than ignored, so the count cannot grow silently.
 */
const KNOWN_SQL = ['apps/api/src/actions/actions.service.ts'];

const WINDOW_PATTERNS = [
  /\b90\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000\b/,
  /\b90\s*\*\s*86[_]?400[_]?000\b/,
  /interval\s+'90 days'/,
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', '.next', '.git', 'coverage'].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec|stories)\.tsx?$/.test(entry))
      out.push(full);
  }
  return out;
}

const FILES = ['apps/api/src', 'apps/web/src', 'packages'].flatMap((d) =>
  sourceFiles(join(REPO, d)),
);

describe('the 90-day engagement window has one definition', () => {
  it('scans a non-empty set of files', () => {
    // The blind case, first. Every assertion below filters this list, so an
    // empty scan would report green having read nothing — a guard that passes
    // because its input was starved.
    expect(FILES.length).toBeGreaterThan(200);
  });

  it('is spelled out only where it is defined', () => {
    const offenders = FILES.filter((file) => {
      const rel = file.slice(REPO.length + 1);
      if (ALLOWED.includes(rel) || KNOWN_SQL.includes(rel)) return false;
      const body = readFileSync(file, 'utf8');
      return WINDOW_PATTERNS.some((pattern) => pattern.test(body));
    }).map((f) => f.slice(REPO.length + 1));

    expect(offenders).toEqual([]);
  });

  it('exposes the window as one rolling value', () => {
    expect(ENGAGEMENT_WINDOW_DAYS).toBe(90);
    expect(ENGAGEMENT_WINDOW_MS).toBe(90 * 24 * 60 * 60 * 1000);
    const now = new Date('2026-05-20T23:00:00.000Z');
    // Rolling: exactly 90 days before the instant, never a calendar anchor.
    expect(engagementWindowStart(now).toISOString()).toBe('2026-02-19T23:00:00.000Z');
  });
});
