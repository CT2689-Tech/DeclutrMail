import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Guards the retired pricing literals. The baseline is the set of hits
 * that already exist, including flag-off pricing surfaces this workstream
 * keeps until they are deleted after launch, plus files owned by other
 * workstreams. New hits fail. A baseline entry whose count dropped only
 * warns, so a sibling branch can delete a line without this check going
 * red. Do not add entries after WS1b merges.
 *
 * Excluded: pricing.config.ts and copy.ts (the formatters), competitor
 * data, and the launch-deck module (it holds the deck's own sentences).
 */
const PATTERN = /\b(30-day money|cleanup action|250 seats|first 250|\$\d)/g;

interface BaselineEntry {
  file: string;
  match: string;
  count: number;
}

const ROOT = join(import.meta.dirname, '../../../..');

function skipped(file: string): boolean {
  return (
    file.endsWith('packages/shared/src/entitlements/pricing.config.ts') ||
    file.endsWith('packages/shared/src/entitlements/copy.ts') ||
    file.endsWith('packages/shared/src/entitlements/literal-guard.test.ts') ||
    file.includes('/copy/launch/') ||
    file.includes('competitor')
  );
}

export function scanLiteralHits(extra: { file: string; text: string }[] = []): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (file: string, text: string) => {
    if (skipped(file)) return;
    PATTERN.lastIndex = 0;
    const matches = text.match(PATTERN) ?? [];
    const by = new Map<string, number>();
    for (const match of matches) by.set(match, (by.get(match) ?? 0) + 1);
    for (const [match, count] of by) {
      counts.set(`${file}\0${match}`, count);
    }
  };
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== 'node_modules') walk(path);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx|md|css)$/.test(name)) continue;
      add(path.slice(ROOT.length + 1), readFileSync(path, 'utf8'));
    }
  };
  walk(join(ROOT, 'apps/web/src'));
  walk(join(ROOT, 'packages/shared/src'));
  for (const file of extra) add(file.file, file.text);
  return counts;
}

function key(file: string, match: string): string {
  return `${file}\0${match}`;
}

export function newLiteralFailures(
  live: Map<string, number>,
  baseline: BaselineEntry[],
): { failures: string[]; warnings: string[] } {
  const failures: string[] = [];
  const warnings: string[] = [];
  const seen = new Map(live);
  for (const entry of baseline) {
    const id = key(entry.file, entry.match);
    const count = seen.get(id) ?? 0;
    if (count < entry.count) {
      warnings.push(`${entry.file} ${entry.match}: baseline ${entry.count}, now ${count}`);
    }
    if (count > entry.count) {
      failures.push(`${entry.file} ${entry.match}: baseline ${entry.count}, now ${count}`);
    }
    seen.delete(id);
  }
  for (const [id, count] of seen) {
    if (count > 0) failures.push(`${id.replace('\0', ' ')}: new hit ×${count}`);
  }
  return { failures, warnings };
}

describe('pricing literal guard', () => {
  const baseline = JSON.parse(
    readFileSync(new URL('./literal-guard-baseline.json', import.meta.url), 'utf8'),
  ) as BaselineEntry[];

  it('fails closed on a new literal and warns when a baseline hit is gone', () => {
    const { failures, warnings } = newLiteralFailures(scanLiteralHits(), baseline);
    if (warnings.length > 0) {
      console.warn(`literal-guard stale baseline entries:\n${warnings.join('\n')}`);
    }
    expect(failures).toEqual([]);
  });

  it('fails a synthetic new literal (negative control)', () => {
    const { failures } = newLiteralFailures(
      scanLiteralHits([
        { file: 'apps/web/src/features/billing/synthetic-literal.tsx', text: 'only$19 once' },
      ]),
      baseline,
    );
    expect(failures.some((failure) => failure.includes('synthetic-literal.tsx'))).toBe(true);
  });
});
