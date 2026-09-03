import { and, eq, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { providerSyncState } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';

/** The Drizzle client, bound to the full `@declutrmail/db` schema. */
type WorkerDb = PostgresJsDatabase<typeof schema>;

/**
 * The classified error name for a revoked or expired Gmail OAuth grant.
 *
 * A string, not an imported class: this package must not depend on
 * `apps/api`, and the value travels as `error.name` anyway. The same
 * literal is the contract at three other sites — the API's
 * `markQueued` clearing rule, `IncrementalSyncWorker.onTerminalFailure`,
 * and the web app's `INVALID_GRANT_CODE` — so changing it means changing
 * all four together.
 */
export const INVALID_GRANT_ERROR = 'InvalidGrantError';

/**
 * Mailboxes NOT currently waiting on a reconnect.
 *
 * The mirror of the frontend's `syncStatusNeedsReconnect`: a recorded
 * `InvalidGrantError` counts only while it is newer than the last
 * successful sync, so a mailbox that has since reconnected and synced
 * becomes eligible again on its own. Anything other than an invalid
 * grant is left alone — a rate limit or a Gmail blip SHOULD be retried
 * next tick.
 *
 * A bare SQL fragment rather than a helper that takes a query: every
 * consumer already joins `provider_sync_state`, and keeping it a
 * fragment lets each `where` compose it with its own predicates.
 *
 * EVERY periodic sweep that spends a mailbox's Gmail grant must include
 * this. A revoked grant is permanent until the user reconnects, so a
 * sweep without it re-attempts the same dead token every tick forever.
 * That is not hypothetical: it has now happened twice, in the two
 * sweeps that both call it today.
 */
export const notNeedingReconnect = or(
  sql`${providerSyncState.lastIncrementalErrorCode} IS DISTINCT FROM ${INVALID_GRANT_ERROR}`,
  sql`${providerSyncState.lastIncrementalErrorAt} IS NULL`,
  sql`${providerSyncState.lastSyncedAt} IS NOT NULL
      AND ${providerSyncState.lastSyncedAt} >= ${providerSyncState.lastIncrementalErrorAt}`,
);

/**
 * Point-lookup mirror of `notNeedingReconnect`, for a producer that
 * handles one mailbox per call instead of a sweep query — a job
 * processor's worker-entry guard, not a `WHERE` clause it composes
 * into.
 *
 * `IncrementalSyncWorker` is fed by three producers: the drift sweep
 * (already filtered via `notNeedingReconnect` in
 * `selectIncrementalDriftCandidates`), the manual "Sync now" button
 * (the FE already disables the action once `needsReconnect` is true),
 * and every verified Gmail Pub/Sub push. The webhook producer has no
 * sweep query to filter — Gmail delivers one push per history event
 * regardless of what this mailbox's last attempt did — so a revoked
 * grant on a mailbox that is still receiving mail re-attempts the
 * token refresh, and re-emits `oauth.refresh_failed`, on every single
 * push until the Gmail watch itself expires. Call this at the SAME
 * worker-entry point as the inactive/deletion-pending checks, before
 * `gmailAccess.getClient`, so the first attempt still discovers +
 * records the revoked grant (`onTerminalFailure`) but every push after
 * that is a cheap DB-only no-op instead of a repeat refresh attempt.
 */
export async function isAwaitingReconnect(
  db: WorkerDb,
  mailboxAccountId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ mailboxAccountId: providerSyncState.mailboxAccountId })
    .from(providerSyncState)
    .where(
      and(
        eq(providerSyncState.mailboxAccountId, mailboxAccountId),
        sql`NOT (${notNeedingReconnect})`,
      ),
    )
    .limit(1);
  return row !== undefined;
}
