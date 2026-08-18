import { or, sql } from 'drizzle-orm';
import { providerSyncState } from '@declutrmail/db';

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
