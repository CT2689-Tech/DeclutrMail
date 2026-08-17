import type { Sql } from 'postgres';

import { MAILBOX_ACTION_LOCK_NS, type MailboxActionLock } from '@declutrmail/workers';

/**
 * Bounded wait for the per-mailbox advisory lock.
 *
 * MUST stay BELOW the smallest job-level cap of any lock consumer:
 * `SnoozeWakeWorker` and `AccountDeletionPurgeWorker` run under
 * `cronPolicy.timeoutMs = 60_000`, and `BaseDeclutrWorker.withTimeout`
 * is a bare `Promise.race` that does NOT cancel the racing promise — a
 * lock wait longer than the job cap would fail-and-retry the job while
 * the original acquire kept waiting, then acquired and ran its body
 * DETACHED from any job (on the deletion path, after the request row
 * was already claimed — a duplicate-purge shape). 45s < 60s closes
 * that; five BullMQ attempts give a stuck lock ~4 minutes of total
 * patience before the dead-letter alert fires.
 */
export const MAILBOX_LOCK_TIMEOUT = '45s';

/**
 * Per-mailbox advisory lock for destructive actions (D226).
 *
 * `perMailboxPolicy` does NOT actually serialize per mailbox (BullMQ
 * runs `concurrency` jobs across mailboxes), and destructive mutations
 * are the wrong place to bet on benign races. A connection reserved
 * from the DEDICATED session-pooled `lockPg` holds the SESSION-level
 * advisory lock for the whole resolve→mutate→commit; the lock is a
 * keyed mutex, so the inner work runs on the MAIN pool. Released in
 * `finally`; on connection loss Postgres drops the session lock.
 *
 * Two-key form `pg_advisory_lock(ns, hashtext(mailbox))` isolates these
 * locks under a label-action namespace. `hashtext` is 32-bit, so two
 * distinct mailboxes can collide and over-serialize — harmless (extra
 * mutual exclusion, never incorrect), and rare.
 *
 * Factored out of the worker composition root so the failure paths are
 * unit-testable — the 2026-08-12 leak survived precisely because the
 * unlock's return value was discarded inside an untested `catch {}`.
 */
export function createMailboxActionLock(lockPg: Sql): MailboxActionLock & {
  /**
   * Boot self-test: prove SESSION semantics on the live pool instead of
   * trusting the DSN's string shape. Acquires a probe key and asserts
   * the unlock returns `true` — over a transaction-mode pooler the
   * unlock lands on a different backend and returns `false`, which is
   * exactly the 2026-08-12 failure. A guard must be tested against its
   * blind case; this is that test, run once per boot.
   */
  probe(): Promise<{ ok: boolean; unlockReturned: boolean | null; error?: string }>;
} {
  return {
    async run(mailboxAccountId, fn) {
      const reserved = await lockPg.reserve();
      // False until pg_advisory_lock RETURNS. The unlock (and the leak
      // diagnosis) must only run for an acquire that succeeded: a
      // `lock_timeout` abort still emits a server-side "you don't own a
      // lock" warning on unlock and would make the leak detector cry
      // wolf on the one failure mode the timeout deliberately creates.
      let acquired = false;
      try {
        // `set_config`, not `SET`: postgres.js sends `${}` as a bind
        // parameter and `SET` cannot take one — the server answers
        // `syntax error at or near "$1"`, which failed EVERY label
        // action from #509 (2026-08-12) until caught 2026-08-16. The
        // mocked spec asserted the string, never executed it.
        await reserved`SELECT set_config('lock_timeout', ${MAILBOX_LOCK_TIMEOUT}, false)`;
        try {
          await reserved`SELECT pg_advisory_lock(${MAILBOX_ACTION_LOCK_NS}, hashtext(${mailboxAccountId}))`;
        } catch (err) {
          // The one log line a blocked consumer is guaranteed to emit.
          // IncrementalSyncWorker takes this lock OUTSIDE its
          // BaseDeclutrWorker envelope (worker.ts composition), so
          // without this line a timed-out sync surfaces nowhere.
          console.error(
            JSON.stringify({
              level: 'error',
              kind: 'mailbox_lock.acquire_failed',
              mailboxAccountId,
              lockTimeout: MAILBOX_LOCK_TIMEOUT,
              message: err instanceof Error ? err.message : String(err),
            }),
          );
          throw err;
        }
        acquired = true;
        return await fn();
      } finally {
        if (acquired) {
          try {
            const [row] = await reserved<
              { pg_advisory_unlock: boolean }[]
            >`SELECT pg_advisory_unlock(${MAILBOX_ACTION_LOCK_NS}, hashtext(${mailboxAccountId}))`;
            if (row?.pg_advisory_unlock !== true) {
              // `false` after a successful acquire means THIS session no
              // longer owns the lock — the pooler rebound backends and
              // the lock just leaked. This is the leak detector; it must
              // be loud.
              console.error(
                JSON.stringify({
                  level: 'error',
                  kind: 'mailbox_lock.unlock_failed',
                  mailboxAccountId,
                  returned: row?.pg_advisory_unlock ?? null,
                }),
              );
            }
          } catch (err) {
            // Best-effort unlock; the session ending releases it — but
            // say so, because a silent catch here hid the 2026-08-12
            // leak.
            console.error(
              JSON.stringify({
                level: 'error',
                kind: 'mailbox_lock.unlock_error',
                mailboxAccountId,
                message: err instanceof Error ? err.message : String(err),
              }),
            );
          }
        }
        reserved.release();
      }
    },

    async probe() {
      try {
        const reserved = await lockPg.reserve();
        try {
          await reserved`SELECT pg_advisory_lock(${MAILBOX_ACTION_LOCK_NS}, hashtext('session-probe'))`;
          const [row] = await reserved<
            { pg_advisory_unlock: boolean }[]
          >`SELECT pg_advisory_unlock(${MAILBOX_ACTION_LOCK_NS}, hashtext('session-probe'))`;
          const unlockReturned = row?.pg_advisory_unlock ?? null;
          return { ok: unlockReturned === true, unlockReturned };
        } finally {
          reserved.release();
        }
      } catch (err) {
        return {
          ok: false,
          unlockReturned: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
