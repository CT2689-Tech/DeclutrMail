import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { mailboxAccounts, providerSyncState } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';

import { notNeedingReconnect } from './mailbox-reconnect.js';

type WorkerDb = PostgresJsDatabase<typeof schema>;

/**
 * How long a mailbox can sit broken before it counts as "stuck" rather
 * than "still inside a legitimate retry window". Long enough that an
 * ordinary transient failure (a Gmail 503, a brief rate limit) resolves
 * on its own without paging anyone; short enough that a genuine outage
 * with nothing retrying it (RateLimitError with no backoff — the andre
 * incident; a revoked grant nothing re-attempts — the nicoleta
 * incident) is caught within the same working day instead of sitting
 * for weeks with no one aware.
 */
export const STUCK_MAILBOX_GRACE_MS = 2 * 60 * 60 * 1000;

export type StuckMailboxReason =
  'sync_failed' | 'sync_stalled' | 'needs_reconnect' | 'incremental_failed';

export interface StuckMailbox {
  mailboxAccountId: string;
  reason: StuckMailboxReason;
  errorCode: string | null;
  stuckSince: Date;
}

/**
 * Find every ACTIVE mailbox silently broken past the grace window, on
 * either shape this codebase has actually shipped — and, being keyed on
 * `readiness_status` / `last_incremental_error_*` rather than any one
 * error code, the next shape too:
 *
 *   - `sync_failed`: initial sync never completed
 *     (`readiness_status = 'failed'`) and nothing has touched the row
 *     since. `updated_at` is trigger-maintained
 *     (`provider_sync_state_set_updated_at`), so a stale value here is
 *     honest — it means no attempt has run since, not a stale write
 *     application code forgot to make.
 *   - `needs_reconnect`: `notNeedingReconnect`'s own condition,
 *     negated — a revoked Gmail grant that has sat unresolved since
 *     before the grace window. This is the shape that left a mailbox
 *     silently dead for 16 days while `readiness_status` still read
 *     `'ready'`.
 *
 * Read-only: never mutates, never calls Gmail. Reuses
 * `notNeedingReconnect` rather than re-deriving the reconnect
 * condition — a second copy of that predicate is exactly the class of
 * drift `mailbox-reconnect.ts` warns against.
 *
 * The caller (the worker.ts scheduler) turns a non-empty result into a
 * structured log line per mailbox; this function only finds them.
 */
export async function findStuckMailboxes(
  db: WorkerDb,
  opts: { graceMs?: number; now?: () => Date } = {},
): Promise<StuckMailbox[]> {
  const graceMs = opts.graceMs ?? STUCK_MAILBOX_GRACE_MS;
  const now = opts.now ?? (() => new Date());
  const cutoff = new Date(now().getTime() - graceMs);

  const syncFailedRows = await db
    .select({
      mailboxAccountId: providerSyncState.mailboxAccountId,
      readinessStatus: providerSyncState.readinessStatus,
      errorCode: providerSyncState.errorCode,
      stuckSince: providerSyncState.updatedAt,
    })
    .from(providerSyncState)
    .innerJoin(mailboxAccounts, eq(mailboxAccounts.id, providerSyncState.mailboxAccountId))
    .where(
      and(
        inArray(providerSyncState.readinessStatus, ['failed', 'queued', 'syncing']),
        eq(mailboxAccounts.status, 'active'),
        lt(providerSyncState.updatedAt, cutoff),
      ),
    );

  const needsReconnectRows = await db
    .select({
      mailboxAccountId: providerSyncState.mailboxAccountId,
      errorCode: providerSyncState.lastIncrementalErrorCode,
      stuckSince: providerSyncState.lastIncrementalErrorAt,
    })
    .from(providerSyncState)
    .innerJoin(mailboxAccounts, eq(mailboxAccounts.id, providerSyncState.mailboxAccountId))
    .where(
      and(
        eq(mailboxAccounts.status, 'active'),
        sql`NOT (${notNeedingReconnect})`,
        lt(providerSyncState.lastIncrementalErrorAt, cutoff),
      ),
    );

  const incrementalFailedRows = await db
    .select({
      mailboxAccountId: providerSyncState.mailboxAccountId,
      errorCode: providerSyncState.lastIncrementalErrorCode,
      stuckSince: providerSyncState.lastIncrementalErrorAt,
    })
    .from(providerSyncState)
    .innerJoin(mailboxAccounts, eq(mailboxAccounts.id, providerSyncState.mailboxAccountId))
    .where(
      and(
        eq(mailboxAccounts.status, 'active'),
        eq(providerSyncState.readinessStatus, 'ready'),
        sql`${providerSyncState.lastIncrementalErrorCode} IS NOT NULL AND ${providerSyncState.lastIncrementalErrorCode} <> 'InvalidGrantError'`,
        lt(providerSyncState.lastIncrementalErrorAt, cutoff),
        sql`(${providerSyncState.lastSyncedAt} IS NULL OR ${providerSyncState.lastSyncedAt} < ${providerSyncState.lastIncrementalErrorAt})`,
      ),
    );

  return [
    ...incrementalFailedRows.map((row): StuckMailbox => ({
      mailboxAccountId: row.mailboxAccountId,
      reason: 'incremental_failed',
      errorCode: row.errorCode,
      stuckSince: row.stuckSince!,
    })),
    ...syncFailedRows.map((row): StuckMailbox => ({
      mailboxAccountId: row.mailboxAccountId,
      reason: row.readinessStatus === 'failed' ? 'sync_failed' : 'sync_stalled',
      errorCode: row.errorCode,
      stuckSince: row.stuckSince,
    })),
    ...needsReconnectRows.map((row): StuckMailbox => ({
      mailboxAccountId: row.mailboxAccountId,
      reason: 'needs_reconnect',
      errorCode: row.errorCode,
      // Non-null: the WHERE clause's `lt(...)` excludes NULL rows.
      stuckSince: row.stuckSince!,
    })),
  ];
}
