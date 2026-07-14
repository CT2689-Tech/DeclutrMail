import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { accountDeletionRequests, mailboxAccounts } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';

/** The Drizzle client, bound to the full `@declutrmail/db` schema. */
type WorkerDb = PostgresJsDatabase<typeof schema>;

/**
 * D232 "Pause sync while pending" — the single eligibility predicate.
 *
 * Once a deletion request is in flight ('pending' or 'executing'), sync
 * MUST NOT run for ANY of the user's mailboxes regardless of OAuth
 * state — otherwise Gmail would silently repopulate the index between
 * request and purge.
 *
 * This is THE chokepoint (not scattered ifs): every sync entry path
 * uses one of these eligibility checks —
 *
 *   - `InitialSyncWorker` / `IncrementalSyncWorker` check
 *     `getSyncMailboxEligibility` at processJob entry — the authoritative
 *     backstop that rejects inactive mailboxes and deletion-pending users
 *     across every producer (webhook, drift sweep, "Sync now",
 *     connect-time enqueue).
 *   - The Gmail webhook's mailbox resolution selects
 *     `deletionPendingSql` inline so a push for a pausing user is a
 *     designed 200 no-op BEFORE the historyId cursor advances —
 *     advancing the cursor while sync is paused would permanently lose
 *     the (S, H] window on cancel.
 *
 * Cancel/resume: the guards read live state, so cancelling the request
 * un-pauses immediately; the next webhook (or drift sweep tick) resumes
 * reconciliation from the unmoved cursor.
 */

/**
 * Raw EXISTS fragment — true when the OWNER (user) of
 * `mailbox_accounts.user_id` has an in-flight deletion request. For
 * embedding in eligibility queries that already join/select from
 * `mailbox_accounts`. Table-qualified raw SQL on the correlated side
 * (drizzle-correlated-subquery pitfall — the `sql` template would emit
 * a bare column name and degenerate to a tautology).
 */
export const deletionPendingSql = sql<boolean>`EXISTS (
  SELECT 1 FROM account_deletion_requests adr
  WHERE adr.user_id = mailbox_accounts.user_id
    AND adr.status IN ('pending', 'executing')
)`;

/** Worker-entry eligibility for Gmail sync jobs. */
export type SyncMailboxEligibility = 'active' | 'inactive' | 'deletion_pending';

/**
 * Resolve the complete sync eligibility in one indexed mailbox lookup.
 *
 * `inactive` includes a missing mailbox: both states are terminal for a
 * queued job and must no-op before OAuth decryption or a Gmail call. The
 * explicit state also keeps disconnect separate from D232's cancellable
 * account-deletion pause.
 */
export async function getSyncMailboxEligibility(
  db: WorkerDb,
  mailboxAccountId: string,
): Promise<SyncMailboxEligibility> {
  const [row] = await db
    .select({ status: mailboxAccounts.status, deletionPending: deletionPendingSql })
    .from(mailboxAccounts)
    .where(sql`${mailboxAccounts.id} = ${mailboxAccountId}`)
    .limit(1);
  if (!row || row.status !== 'active') {
    return 'inactive';
  }
  return row.deletionPending ? 'deletion_pending' : 'active';
}

/**
 * True when the mailbox's OWNER has an in-flight deletion request —
 * the worker-entry guard. One indexed lookup (mailbox PK + the
 * per-user partial unique index on account_deletion_requests).
 */
export async function isSyncPausedForDeletion(
  db: WorkerDb,
  mailboxAccountId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ paused: deletionPendingSql })
    .from(mailboxAccounts)
    .where(sql`${mailboxAccounts.id} = ${mailboxAccountId}`)
    .limit(1);
  // Unknown mailbox → not paused (the worker's own row lookups will
  // surface the missing mailbox as their designed outcome).
  return row?.paused === true;
}

/** True when the user has an in-flight deletion request (purge-side reads). */
export async function hasInFlightDeletion(db: WorkerDb, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: accountDeletionRequests.id })
    .from(accountDeletionRequests)
    .where(
      sql`${accountDeletionRequests.userId} = ${userId}
          AND ${accountDeletionRequests.status} IN ('pending', 'executing')`,
    )
    .limit(1);
  return row !== undefined;
}
