import { MailboxReconnectRequiredPayloadSchema, TOPICS } from '@declutrmail/events';
import { OutboxPublisher } from './outbox-publisher.js';
import { and, eq, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { mailboxAccounts, providerSyncState } from '@declutrmail/db';
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

/** What {@link recordMailboxSyncFailure} did with a failure. */
export type MailboxSyncFailureOutcome =
  /** Evidence written (and, for a revoked grant, the reconnect notice). */
  | 'recorded'
  /** A revoked grant from an attempt that began before the last connect. */
  | 'superseded'
  /** The same revoked grant is already on record; nothing re-notified. */
  | 'already_awaiting'
  /** No live mailbox to record against. */
  | 'skipped';

/**
 * Persist the incident and notification atomically for every producer of reconnect state.
 *
 * `attemptStartedAt` — when the failing attempt began, taken before it
 * read the mailbox's credential; `null` when unknown (then it records, as
 * before). A revoked grant from an attempt that began before the mailbox
 * was last connected is treated as the grant that connect replaced and
 * ignored (`superseded`): a sign-in keeps a synced mailbox `ready`, so
 * no re-scan stamps `last_synced_at` over the error, and recording it
 * would put a just-reconnected mailbox straight back behind the
 * reconnect gate and send the reconnect email.
 *
 * What this relies on, and what it leaves open:
 * - READ COMMITTED: the `connected_at` read runs after the sync-row lock,
 *   as its own statement, so a connect that committed while this waited
 *   is visible.
 * - `connected_at` is stamped when the connect's upsert is built, before
 *   its commit. An attempt that starts inside that short tail still reads
 *   the old credential, fails after the commit, and is recorded — the
 *   mailbox is re-gated until the user reconnects again. Worker/API clock
 *   skew moves the boundary by the skew. The exact fix compares grant
 *   identity (the `connected_at` the credential was read with) instead of
 *   time, which needs the Gmail client to carry it on its errors.
 */
export async function recordMailboxSyncFailure(
  db: WorkerDb,
  mailboxAccountId: string,
  errorCode: string,
  opts: { attemptStartedAt: Date | null },
): Promise<MailboxSyncFailureOutcome> {
  return db.transaction(async (tx): Promise<MailboxSyncFailureOutcome> => {
    let [state] = await tx
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxAccountId))
      .for('update');
    if (!state) {
      // A periodic sweep can discover revoked credentials before sync has created
      // its state row. Persist that first incident too, or every tick retries it.
      const [active] = await tx
        .select({ id: mailboxAccounts.id })
        .from(mailboxAccounts)
        .where(and(eq(mailboxAccounts.id, mailboxAccountId), eq(mailboxAccounts.status, 'active')));
      if (!active) return 'skipped';
      await tx.insert(providerSyncState).values({ mailboxAccountId }).onConflictDoNothing();
      [state] = await tx
        .select()
        .from(providerSyncState)
        .where(eq(providerSyncState.mailboxAccountId, mailboxAccountId))
        .for('update');
      if (!state) return 'skipped';
    }
    // After the row lock above, so a connect that committed while this
    // transaction waited on it is visible here.
    if (errorCode === INVALID_GRANT_ERROR && opts.attemptStartedAt) {
      const [mailbox] = await tx
        .select({ connectedAt: mailboxAccounts.connectedAt })
        .from(mailboxAccounts)
        .where(eq(mailboxAccounts.id, mailboxAccountId));
      if (mailbox?.connectedAt && mailbox.connectedAt > opts.attemptStartedAt) {
        console.log(
          JSON.stringify({
            level: 'info',
            kind: 'sync.superseded_grant_failure_ignored',
            mailboxAccountId,
          }),
        );
        return 'superseded';
      }
    }
    const alreadyAwaiting =
      state.lastIncrementalErrorCode === 'InvalidGrantError' &&
      state.lastIncrementalErrorAt !== null &&
      (state.lastSyncedAt === null || state.lastIncrementalErrorAt > state.lastSyncedAt);
    // Duplicate terminal callbacks must not shift the incident timestamp or notify twice.
    if (alreadyAwaiting) return 'already_awaiting';
    const unresolved =
      state.lastIncrementalErrorAt !== null &&
      (state.lastSyncedAt === null || state.lastIncrementalErrorAt > state.lastSyncedAt);
    // Preserve the start of a retryable outage so repeated attempts cannot reset the watchdog grace window.
    const failedAt =
      errorCode !== 'InvalidGrantError' && unresolved ? state.lastIncrementalErrorAt! : new Date();
    await tx
      .update(providerSyncState)
      .set({
        lastIncrementalErrorAt: failedAt,
        lastIncrementalErrorCode: errorCode,
        updatedAt: failedAt,
      })
      .where(eq(providerSyncState.mailboxAccountId, mailboxAccountId));
    if (errorCode === 'InvalidGrantError') {
      const [account] = await tx
        .select({ workspaceId: mailboxAccounts.workspaceId })
        .from(mailboxAccounts)
        .where(and(eq(mailboxAccounts.id, mailboxAccountId), eq(mailboxAccounts.status, 'active')));
      if (account)
        await new OutboxPublisher().publish(tx, {
          topic: TOPICS.MAILBOX_RECONNECT_REQUIRED,
          aggregateId: mailboxAccountId,
          schema: MailboxReconnectRequiredPayloadSchema,
          payload: {
            mailboxAccountId,
            workspaceId: account.workspaceId,
            failedAt: failedAt.toISOString(),
            errorCode,
          },
        });
    }
    return 'recorded';
  });
}
