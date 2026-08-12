import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sql } from 'postgres';

import { createMailboxActionLock, MAILBOX_LOCK_TIMEOUT } from './mailbox-action-lock';

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
  /** Value the unlock statement resolves with; default true. */
  unlockReturns?: boolean;
  /** Throw on the pg_advisory_unlock statement. */
  unlockError?: Error;
}

function makeFakePool(behavior: FakeBehavior) {
  const statements: string[] = [];
  const release = vi.fn();
  const reserved = (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join('?');
    statements.push(text);
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
    reserve: () => Promise.resolve(reserved),
  } as unknown as Sql;
  return { pool, statements, release };
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
    const { pool, statements, release } = makeFakePool({});
    const lock = createMailboxActionLock(pool);
    const result = await lock.run('mailbox-1', () => Promise.resolve('done'));
    expect(result).toBe('done');
    expect(statements[0]).toContain('SET lock_timeout');
    expect(statements[1]).toContain('pg_advisory_lock(');
    expect(statements[2]).toContain('pg_advisory_unlock(');
    expect(release).toHaveBeenCalledOnce();
    expect(errorSpy).not.toHaveBeenCalled();
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

  it('exposes a lock timeout below the smallest consumer job cap (cronPolicy 60s)', () => {
    // Guard against a future bump re-opening the detached-execution
    // window on SnoozeWake / AccountDeletionPurge (Promise.race caps
    // do not cancel the losing promise).
    expect(Number.parseInt(MAILBOX_LOCK_TIMEOUT, 10)).toBeLessThan(60);
  });
});
