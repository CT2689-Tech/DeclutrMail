/**
 * Continuous initial-sync reconciler.
 *
 * `provider_sync_state` is the durable sync intent; BullMQ is the
 * execution cache. When the two disagree, the DB wins and this sweep
 * materializes the missing job. It runs on a timer in the worker's
 * composition root (`worker.ts`), and lives here so it can be tested
 * without booting one.
 *
 * TWO stuck shapes, and they are not the same failure:
 *
 *   queued  — the connect path wrote the row and the best-effort
 *             enqueue lost (Redis down at connect time). There was
 *             never a job.
 *   syncing — a job started, then its BullMQ hash was evicted mid-
 *             active (Redis active-hash eviction, flush, failover). The
 *             DB was never flipped, so the onboarding progress bar
 *             wedges forever and nothing sweeps it. Rare, but it is the
 *             stuck-sync class CLAUDE.md §8 warns about.
 *
 * The `syncing` sweep is age-gated because `readiness_status='syncing'`
 * is also the normal state of a healthy in-flight sync. The initial-sync
 * worker heartbeats `updated_at` on every stage transition
 * (`upsertSyncState`), so a stale timestamp — not the status alone —
 * is what distinguishes "wedged" from "working".
 *
 * ## Why neither sweep passes `force`
 *
 * FOUNDER-FOLLOWUPS (2026-07-08) proposed routing the `syncing` sweep
 * through `ensureInitialSyncJob(force: true)`. It should not, and the
 * reason is worth keeping: `force` exists to reap a job that is LIVE but
 * not `active` — `waiting`, `delayed`, `prioritized`. The eviction this
 * sweep exists to fix produces the opposite shape: `getJob` returns
 * `null`, or a thin handle whose state is `unknown`. Both are already
 * recovered without `force`.
 *
 * What `force` would additionally reap is a `delayed` job — which is
 * precisely a retry waiting out its backoff (`initialSyncJobOptions`
 * sets `attempts` + `backoff`). Re-adding that job resets its attempt
 * counter, converting bounded backoff into a faster, longer retry loop
 * against a mailbox that is already failing. So: no `force`. A job that
 * is genuinely waiting or delayed is left alone, and BullMQ's own
 * stalled-job recovery owns the case where a worker died holding one.
 */

import { providerSyncState } from '@declutrmail/db';
import { and, eq, lt } from 'drizzle-orm';

import type { DrizzleDb } from '../db/db.module.js';

/** How long a `syncing` row may go without a heartbeat before it is swept. */
export const STALE_SYNCING_AFTER_MS = 15 * 60 * 1000;

/** Max rows read per status per tick — the sweep is bounded, not exhaustive. */
export const RECONCILE_BATCH = 100;

export interface ReconcileOutcome {
  added: number;
  replaced: number;
  scanned: number;
  /** Subset of `scanned` that came from the stale-`syncing` sweep. */
  staleSyncing: number;
}

export interface ReconcileDeps {
  /**
   * Drizzle handle; only `provider_sync_state` is read. Typed as the
   * concrete production handle — the PGlite spec passes `db as never`,
   * which is this codebase's established bridge for the two drizzle
   * dialects (see `actions.service.spec.ts`).
   */
  db: DrizzleDb;
  /**
   * Schedules one mailbox, returning what it did. This is
   * `ensureInitialSyncJob` bound to the reconciler's queue — injected
   * rather than imported so the test does not need a live Redis.
   */
  schedule: (mailboxAccountId: string) => Promise<'added' | 'replaced' | 'noop'>;
  /** Checked between rows so a mid-sweep shutdown stops promptly. */
  isShuttingDown: () => boolean;
  /** Now, injectable so the age gate is testable without waiting 15 minutes. */
  now?: () => Date;
  batchSize?: number;
  staleSyncingAfterMs?: number;
}

/**
 * One reconciliation tick. Reads up to `batchSize` rows per stuck shape
 * and ensures each has a live BullMQ job.
 *
 * Throws nothing of its own — the caller owns failure logging, because
 * the worker routes it to both a structured log line and Sentry. A
 * database error propagates so the caller can do that; every other path
 * returns counts.
 */
export async function reconcileInitialSyncs(deps: ReconcileDeps): Promise<ReconcileOutcome> {
  const {
    db,
    schedule,
    isShuttingDown,
    now = () => new Date(),
    batchSize = RECONCILE_BATCH,
    staleSyncingAfterMs = STALE_SYNCING_AFTER_MS,
  } = deps;

  const staleBefore = new Date(now().getTime() - staleSyncingAfterMs);

  const queuedRows = await db
    .select({ mailboxAccountId: providerSyncState.mailboxAccountId })
    .from(providerSyncState)
    .where(eq(providerSyncState.readinessStatus, 'queued'))
    .limit(batchSize);

  // Age-gated: `syncing` is the healthy in-flight state too, so the
  // heartbeat is the discriminator, not the status.
  const staleSyncingRows = await db
    .select({ mailboxAccountId: providerSyncState.mailboxAccountId })
    .from(providerSyncState)
    .where(
      and(
        eq(providerSyncState.readinessStatus, 'syncing'),
        lt(providerSyncState.updatedAt, staleBefore),
      ),
    )
    .limit(batchSize);

  let added = 0;
  let replaced = 0;
  // A mailbox can only appear once — the two statuses are mutually
  // exclusive on a single row — so the lists cannot overlap.
  const rows = [...queuedRows, ...staleSyncingRows];

  for (const { mailboxAccountId } of rows) {
    if (isShuttingDown()) {
      // Honor a mid-sweep shutdown signal — leftover rows pick up on
      // the next tick or the next worker boot.
      break;
    }
    const outcome = await schedule(mailboxAccountId);
    if (outcome === 'added') added += 1;
    if (outcome === 'replaced') replaced += 1;
  }

  return {
    added,
    replaced,
    scanned: rows.length,
    staleSyncing: staleSyncingRows.length,
  };
}
