import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every connection pool that holds SESSION state must be built from a
 * session-mode DSN.
 *
 * Two kinds of Postgres state are per-session, not per-statement:
 *
 *   - `pg_advisory_lock` (the session-scoped form, NOT
 *     `pg_advisory_xact_lock`) binds to a backend until explicitly
 *     unlocked.
 *   - `LISTEN` subscribes a backend to a channel.
 *
 * Through Supabase's TRANSACTION pooler (`…pooler.supabase.com:6543`)
 * each statement can land on a different backend, so a lock taken on one
 * backend is unlocked on another — leaking it — and a LISTEN is silently
 * dropped so notifications never arrive. `toSessionPoolUrl()` rewrites
 * :6543 to the session pooler on :5432, which pins one backend per
 * client.
 *
 * THIS HAS BITTEN TWICE. The 2026-08-12 incident (MISTAKES.md) was a
 * leaked advisory lock from a pooled DSN. `apps/api/scripts/
 * dev-autopilot-harness.ts` then shipped with the same defect, and its
 * own leak-detector comment described the hazard it had — the DSN was
 * simply never converted. Because that harness shares
 * `MAILBOX_ACTION_LOCK_NS`, a lock leaked there blocks the PRODUCTION
 * worker. Detecting a leak is not preventing one, and a comment is not
 * an enforcement.
 *
 * The rule is deliberately keyed on the VARIABLE NAME rather than on
 * dataflow: pools that take session state are named for what they do
 * (`lockPg`, `outboxListenPg`), a static grep cannot follow the DSN
 * through a helper, and a name-based rule is one a reviewer can apply by
 * eye. A pool that genuinely needs no session state (the ordinary query
 * pool) must simply not be named for locking or listening.
 */

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

/** Roots that may construct a pool: the API (incl. scripts) and workers. */
const ROOTS = [join(REPO_ROOT, 'apps', 'api'), join(REPO_ROOT, 'packages', 'workers', 'src')];

/** Pool variables whose name promises session state. */
const SESSION_POOL_NAME = /\b(?:const|let|var)\s+(\w*(?:[lL]ock|[lL]isten)\w*)\s*=\s*postgres\(/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.ts$/.test(entry) && !/\.(spec|test)\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function sourceFiles(): string[] {
  return ROOTS.flatMap((root) => walk(root));
}

describe('session-state pools are built from a session-mode DSN', () => {
  it('finds the pools it is meant to police', () => {
    // A guard that matches nothing passes forever. Prove it has targets.
    const found = sourceFiles().flatMap((file) => {
      const src = readFileSync(file, 'utf8');
      return [...src.matchAll(SESSION_POOL_NAME)].map((m) => m[1]);
    });
    expect(found.length).toBeGreaterThan(0);
  });

  it('wraps every lock/listen pool DSN in toSessionPoolUrl()', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      const src = readFileSync(file, 'utf8');
      for (const match of src.matchAll(SESSION_POOL_NAME)) {
        // The DSN argument is whatever follows `postgres(` up to the
        // options object — the only question is where it came from.
        const start = (match.index ?? 0) + match[0].length;
        const dsnArg = (src.slice(start, start + 200).split(/,\s*\{/)[0] ?? '').trim();

        // Wrapped inline: `postgres(toSessionPoolUrl(...), {...})`.
        if (dsnArg.includes('toSessionPoolUrl(')) continue;

        // ONE LEVEL OF INDIRECTION IS THE NORMAL SHAPE, not an evasion —
        // `worker.ts` computes `const lockDatabaseUrl =
        // toSessionPoolUrl(databaseUrl)` and passes that. Refusing it
        // would make this guard cry wolf on the two call sites that are
        // already correct, and a guard that cries wolf gets deleted.
        if (/^\w+$/.test(dsnArg)) {
          const assigned = new RegExp(
            `\\b(?:const|let|var)\\s+${dsnArg}\\s*=\\s*toSessionPoolUrl\\(`,
          );
          if (assigned.test(src)) continue;
        }

        offenders.push(`${file.replace(REPO_ROOT, '')}: ${match[1]} <- ${dsnArg}`);
      }
    }

    expect(offenders, 'pools holding session state must use toSessionPoolUrl()').toEqual([]);
  });
});
