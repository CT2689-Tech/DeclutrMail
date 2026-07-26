import { sql } from 'drizzle-orm';

/**
 * Per-mailbox mutual exclusion between the sender-index REBUILD and the
 * Autopilot writers that derive rows from that index.
 *
 * Why a lock and not a comparison: `AutopilotApplyWorker` fingerprints
 * the index before it reads signals and re-checks before it writes, but
 * a bare re-check is check-then-act — `InitialSyncWorker` can commit in
 * the gap between the comparison and the `INSERT`, and the matches land
 * anyway. Holding this lock across BOTH statements is what makes the
 * pair atomic. The declared `concurrencyScope: 'perMailbox'` cannot do
 * the job: nothing reads that field (see `apps/api/src/worker.ts` — "true
 * per-mailbox concurrency=1 is not enforced at the consumer").
 *
 * Transaction-scoped, so it is released by COMMIT or ROLLBACK — there is
 * no unlock path to leak. Both sides BLOCK rather than try-and-skip:
 * the writer's transaction is short (one INSERT), and a writer that
 * waits out a rebuild then finds a changed fingerprint and abandons its
 * pass, which is exactly the desired outcome. Deadlock is not reachable
 * — the rebuild cannot touch a writer's rows until it holds this lock,
 * and the writer holds it only until its own COMMIT.
 *
 * `hashtext` maps the mailbox uuid onto the int4 the two-argument form
 * needs; collisions across mailboxes only ever cost a needless wait.
 */
const SENDER_INDEX_LOCK_NAMESPACE = 8_251;

/** Minimal executor surface — satisfied by a Drizzle db or transaction. */
type LockExecutor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

/**
 * Take the mailbox's sender-index lock for the rest of THIS transaction.
 * Blocks until any holder commits or rolls back. Must be called inside a
 * transaction — outside one the lock is taken and released immediately,
 * which silently buys no exclusion at all.
 */
export async function lockSenderIndex(tx: LockExecutor, mailboxAccountId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${SENDER_INDEX_LOCK_NAMESPACE}, hashtext(${mailboxAccountId}))`,
  );
}
