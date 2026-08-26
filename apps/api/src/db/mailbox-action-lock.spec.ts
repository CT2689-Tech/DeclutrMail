import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sql } from 'postgres';

import {
  createMailboxActionLock,
  LOCK_POOL_WAIT_WARN_MS,
  MAILBOX_LOCK_TIMEOUT,
} from './mailbox-action-lock';

/**
 * The 2026-08-12 leak survived because the unlock's boolean was
 * discarded inside an untested `catch {}`. These tests pin every
 * failure path of the detector that replaced it — including the blind
 * case (an acquire that never succeeded must not run the unlock, or
 * the detector cries wolf on the very timeout this lock introduces).
 */

interface FakeBehavior {
  /** Throw on the pg_advisory_lock statement. */
  acquireError?: Error;
  /** Milliseconds `reserve()` blocks before handing back a connection. */
  reserveDelayMs?: number;
  /** Value the unlock statement resolves with; default true. */
  unlockReturns?: boolean;
  /** Throw on the pg_advisory_unlock statement. */
  unlockError?: Error;
}

function makeFakePool(behavior: FakeBehavior) {
  const statements: string[] = [];
  const boundValues: unknown[][] = [];
  const release = vi.fn();
  const reserved = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push(text);
    boundValues.push(values);
    if (text.includes('pg_advisory_lock(')) {
      if (behavior.acquireError) return Promise.reject(behavior.acquireError);
      return Promise.resolve([]);
    }
    if (text.includes('pg_advisory_unlock(')) {
      if (behavior.unlockError) return Promise.reject(behavior.unlockError);
      return Promise.resolve([{ pg_advisory_unlock: behavior.unlockReturns ?? true }]);
    }
    return Promise.resolve([]);
  };
  (reserved as unknown as { release: typeof release }).release = release;
  const pool = {
    reserve: () =>
      behavior.reserveDelayMs === undefined
        ? Promise.resolve(reserved)
        : new Promise((resolve) => setTimeout(() => resolve(reserved), behavior.reserveDelayMs)),
  } as unknown as Sql;
  return { pool, statements, boundValues, release };
}

describe('createMailboxActionLock', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  function loggedKinds(): string[] {
    return errorSpy.mock.calls.map(
      (c: unknown[]) => (JSON.parse(String(c[0])) as { kind: string }).kind,
    );
  }

  it('happy path: sets lock_timeout, acquires, runs fn, unlocks, releases — no error logs', async () => {
    const { pool, statements, boundValues, release } = makeFakePool({});
    const lock = createMailboxActionLock(pool);
    const result = await lock.run('mailbox-1', () => Promise.resolve('done'));
    expect(result).toBe('done');
    expect(statements[0]).toContain("set_config('lock_timeout'");
    expect(boundValues[0]).toEqual([MAILBOX_LOCK_TIMEOUT]);
    expect(statements[1]).toContain('pg_advisory_lock(');
    expect(statements[2]).toContain('pg_advisory_unlock(');
    expect(release).toHaveBeenCalledOnce();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('never issues a parameterized SET — the server rejects `SET x = $1` outright', async () => {
    // Regression pin for the #509 outage: `SET lock_timeout = ${...}`
    // reaches Postgres as `SET lock_timeout = $1`, a syntax error that
    // failed every label action for four days. A GUC assignment that
    // needs a bind parameter must go through set_config(). This fake
    // never executes SQL, so the ONLY thing it can verify is the shape:
    // any statement that starts with SET must carry zero bind values.
    const { pool, statements, boundValues } = makeFakePool({});
    const lock = createMailboxActionLock(pool);
    await lock.run('mailbox-1', () => Promise.resolve(undefined));
    for (const [i, text] of statements.entries()) {
      if (/^\s*SET\b/i.test(text)) {
        expect(boundValues[i]).toEqual([]);
      }
    }
  });

  it('unlock returning false logs the leak detector and still releases', async () => {
    const { pool, release } = makeFakePool({ unlockReturns: false });
    const lock = createMailboxActionLock(pool);
    await lock.run('mailbox-1', () => Promise.resolve(undefined));
    expect(loggedKinds()).toEqual(['mailbox_lock.unlock_failed']);
    expect(release).toHaveBeenCalledOnce();
  });

  it('a failed acquire rethrows, logs acquire_failed, and NEVER attempts the unlock', async () => {
    const timeout = new Error('canceling statement due to lock timeout');
    const { pool, statements, release } = makeFakePool({ acquireError: timeout });
    const lock = createMailboxActionLock(pool);
    const fn = vi.fn();
    await expect(lock.run('mailbox-1', fn)).rejects.toThrow('lock timeout');
    expect(fn).not.toHaveBeenCalled();
    // The blind case: no unlock statement, no unlock_failed false alarm.
    expect(statements.some((s) => s.includes('pg_advisory_unlock('))).toBe(false);
    expect(loggedKinds()).toEqual(['mailbox_lock.acquire_failed']);
    expect(release).toHaveBeenCalledOnce();
  });

  it('an unlock that throws logs unlock_error and still releases; fn result survives', async () => {
    const { pool, release } = makeFakePool({ unlockError: new Error('conn reset') });
    const lock = createMailboxActionLock(pool);
    const result = await lock.run('mailbox-1', () => Promise.resolve(41 + 1));
    expect(result).toBe(42);
    expect(loggedKinds()).toEqual(['mailbox_lock.unlock_error']);
    expect(release).toHaveBeenCalledOnce();
  });

  it('probe: session semantics prove out as ok:true', async () => {
    const { pool } = makeFakePool({});
    const lock = createMailboxActionLock(pool);
    await expect(lock.probe()).resolves.toEqual({ ok: true, unlockReturned: true });
  });

  it('probe: a transaction-pooled DSN (unlock=false) reports ok:false', async () => {
    const { pool } = makeFakePool({ unlockReturns: false });
    const lock = createMailboxActionLock(pool);
    await expect(lock.probe()).resolves.toEqual({ ok: false, unlockReturned: false });
  });

  it('logs a queued pool checkout — the step that had no log line of its own', async () => {
    // `reserve()` queues unbounded when all connections are checked out,
    // and it runs BEFORE `lock_timeout` is set, so nothing aborts it and
    // `pg_stat_statements` never sees it (no statement ran). 26.5 h of
    // accumulated wait read as "slow sync", never as "pool too small".
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { pool } = makeFakePool({ reserveDelayMs: LOCK_POOL_WAIT_WARN_MS + 20 });
    const lock = createMailboxActionLock(pool);

    await lock.run('mailbox-1', async () => 'done');

    const logged = warnSpy.mock.calls.map(([line]) => JSON.parse(String(line)));
    const waitLine = logged.find((l) => l.kind === 'mailbox_lock.pool_wait');
    expect(waitLine).toBeDefined();
    expect(waitLine.mailboxAccountId).toBe('mailbox-1');
    expect(waitLine.reserveWaitMs).toBeGreaterThanOrEqual(LOCK_POOL_WAIT_WARN_MS);
    warnSpy.mockRestore();
  });

  it('stays silent when the pool hands back a connection immediately', async () => {
    // A healthy pool must not log on every action, or the signal is
    // worth nothing.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { pool } = makeFakePool({});
    const lock = createMailboxActionLock(pool);

    await lock.run('mailbox-1', async () => 'done');

    expect(
      warnSpy.mock.calls.filter(([line]) => String(line).includes('mailbox_lock.pool_wait')),
    ).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it('exposes a lock timeout below the smallest consumer job cap (cronPolicy 60s)', () => {
    // Guard against a future bump re-opening the detached-execution
    // window on SnoozeWake / AccountDeletionPurge (Promise.race caps
    // do not cancel the losing promise).
    expect(Number.parseInt(MAILBOX_LOCK_TIMEOUT, 10)).toBeLessThan(60);
  });
});
