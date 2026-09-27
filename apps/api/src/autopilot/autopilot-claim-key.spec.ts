import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every claim key is built from `AUTOPILOT_CLAIM_KEY_PREFIXES`
 * (`@declutrmail/db`).
 *
 * A match's durable execution claim is the `action_jobs` row keyed
 * `<prefix><matchId>`. The action worker writes it; the evidence test the
 * sweep and the Quiet count share, the sender-index rebuild's cleanup, the
 * D251 demotion and the in-flight actions list recognise it. A reader that
 * spells the prefix itself keeps passing every test after a format change
 * — the fixtures seed the same old spelling — and then reads real claims
 * as unclaimed: the rebuild deletes a match mid-execution and the sweep
 * stops loading it, stranding a Gmail change.
 *
 * Source-scanning on purpose, like `worker-result-keys.test.ts`: the
 * failure is a string literal, which no type can see. Test files are out
 * of scope — a fixture seeding the old spelling fails loudly on a format
 * change instead of hiding it. It lives in apps/api because CI runs the
 * API suite for a change under any of the three roots it scans.
 */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCANNED_ROOTS = ['packages/workers/src', 'packages/db/src', 'apps/api/src'];
const CONSTANT_FILE = 'packages/db/src/autopilot-suggestions.ts';

/**
 * A literal that spells a claim-key prefix: quoted or templated
 * (`'autopilot-'`, `` `autopilot-${`` ), a SQL LIKE (`'autopilot-%'`,
 * `'autopilot%'`) or an anchored regex (`/^autopilot-`, `'^autopilot-`).
 * Not every spelling: a bare `'autopilot'` is also a capability name, and
 * an unanchored `/autopilot-/` also matches file paths in comments.
 */
const CLAIM_LITERAL =
  /(['"`/])\^?autopilot-(?:unsubexec-?)?(?:\1|\$\{|%)|[/'"`]\^autopilot-|['"`]autopilot%/;

function productionSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && !entry.name.startsWith('__')) walk(path);
      } else if (
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts') &&
        !entry.name.endsWith('.spec.ts')
      ) {
        out.push(relative(REPO_ROOT, path));
      }
    }
  };
  for (const root of SCANNED_ROOTS) walk(join(REPO_ROOT, root));
  return out;
}

function claimLiteralSites(files: string[]): string[] {
  const sites: string[] = [];
  for (const file of files) {
    readFileSync(join(REPO_ROOT, file), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (CLAIM_LITERAL.test(line)) sites.push(`${file}:${i + 1}`);
      });
  }
  return sites;
}

describe('Autopilot claim keys', () => {
  it('recognises a claim-key literal and nothing else', () => {
    expect(CLAIM_LITERAL.test("where aj.idempotency_key = 'autopilot-' || id")).toBe(true);
    expect(CLAIM_LITERAL.test('const key = "autopilot-" + id;')).toBe(true);
    expect(CLAIM_LITERAL.test('const key = `autopilot-${match.matchId}`;')).toBe(true);
    expect(CLAIM_LITERAL.test('const key = `autopilot-unsubexec-${match.matchId}`;')).toBe(true);
    expect(CLAIM_LITERAL.test("['autopilot-', 'autopilot-unsubexec-']")).toBe(true);
    expect(CLAIM_LITERAL.test("where idempotency_key not like 'autopilot-%'")).toBe(true);
    expect(CLAIM_LITERAL.test("where idempotency_key like 'autopilot-unsubexec-%'")).toBe(true);
    expect(CLAIM_LITERAL.test("format('autopilot-%s', id)")).toBe(true);
    expect(CLAIM_LITERAL.test("key.startsWith('autopilot-unsubexec')")).toBe(true);
    expect(CLAIM_LITERAL.test("key.replace(/^autopilot-(?:unsubexec-)?/, '')")).toBe(true);
    expect(CLAIM_LITERAL.test("where idempotency_key not like 'autopilot%'")).toBe(true);
    expect(CLAIM_LITERAL.test("where idempotency_key ~ '^autopilot-(unsubexec-)?'")).toBe(true);
    expect(CLAIM_LITERAL.test('// see packages/workers/src/autopilot-action.worker.ts')).toBe(
      false,
    );
    expect(CLAIM_LITERAL.test("export const AUTOPILOT_ACTION_QUEUE = 'autopilot-action';")).toBe(
      false,
    );
    expect(CLAIM_LITERAL.test("hasCapability(tier, 'autopilot-active')")).toBe(false);
  });

  it('scans the real sources, and sees the literal in the constant itself', () => {
    const files = productionSources();
    // A scan that reads nothing finds nothing: prove it read every root.
    for (const root of SCANNED_ROOTS) {
      expect(files.filter((f) => f.startsWith(`${root}/`)).length).toBeGreaterThan(20);
    }
    expect(files).toContain(CONSTANT_FILE);
    expect(claimLiteralSites([CONSTANT_FILE])).toHaveLength(1);
  });

  it('spells the prefix nowhere but AUTOPILOT_CLAIM_KEY_PREFIXES', () => {
    const outside = claimLiteralSites(productionSources()).filter(
      (site) => !site.startsWith(`${CONSTANT_FILE}:`),
    );
    expect(outside).toEqual([]);
  });
});
