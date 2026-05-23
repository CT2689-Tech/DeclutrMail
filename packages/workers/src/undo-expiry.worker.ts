import { lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { undoJournal } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import type { WorkerContext } from './worker-context.js';

/** The Drizzle client, bound to the full `@declutrmail/db` schema. */
type WorkerDb = PostgresJsDatabase<typeof schema>;

/**
 * Periodic cleanup payload. The cron scheduler enqueues one job per
 * tick keyed on `(worker_name, scheduled_at_minute)` per D225; the
 * payload itself carries no per-mailbox state because the worker
 * scans the full table.
 */
export interface UndoExpiryJobData {
  /**
   * The scheduling minute, used as the BullMQ jobId for cron-keyed
   * idempotency per D225. Format: ISO-8601 minute (`2026-05-23T14:35`).
   * The scheduler caller derives this from `now()` rounded to the
   * minute boundary.
   */
  scheduledAtMinute: string;
}

/**
 * Counts returned by one cleanup pass — logged on `worker.succeeded`.
 *
 * Metric-only per the `BaseDeclutrWorker.processJob` contract. No row
 * data (no mailbox ids, no tokens) leaks into the structured log.
 */
export interface UndoExpiryResult {
  /** Number of rows hard-deleted this pass. */
  deleted: number;
  /** Total wall-clock ms. */
  durationMs: number;
}

/**
 * UndoExpiryWorker (D35, D58, D232) — hard-deletes expired undo tokens.
 *
 * Policy: `cronPolicy` (D203/D225). Fires every 5 minutes; the
 * BullMQ scheduler in the composition root (`apps/api/src/worker.ts`)
 * uses a repeatable job with the cron expression. Idempotency key is
 * the scheduling minute per D225.
 *
 * Deletion policy: **hard-delete** of rows where
 * `expires_at < now() - interval '1 day'`. Rationale for the 1-day
 * lag:
 *
 *   - On expiry-boundary requests, the controller returns HTTP 410
 *     based on `expires_at <= now()`. Hard-deleting at exactly
 *     `expires_at` would race the boundary request and return 404
 *     instead of 410 — different UX (D58's "Undo expired" tooltip
 *     vs a "not found" error). The 1-day buffer guarantees a clean
 *     410 for any boundary-hour request.
 *
 *   - The activity_log row's `undo_token` FK uses `ON DELETE SET NULL`
 *     (see `packages/db/src/schema/activity-log.ts`), so the historical
 *     row outlives the journal entry — no cascade-loss of audit trail.
 *
 *   - Soft-delete was considered + rejected: undo tokens contain no
 *     user-recoverable state (the action ALREADY happened; the journal
 *     records how to reverse it). Once expired they have no read path.
 *     A `deleted_at` column would just bloat the index without product
 *     value.
 *
 * Privacy (D7, D228): nothing fetched, only deleted. The DELETE
 * targets only token+lifecycle columns; payload (Gmail message ids
 * only — no body) goes with them.
 *
 * Failure mode: a single failed pass is harmless. The next 5-minute
 * tick re-attempts. The 1-day lag means a multi-hour outage of the
 * worker cannot orphan any row before the cleanup catches up.
 */
export class UndoExpiryWorker extends BaseDeclutrWorker<UndoExpiryJobData, UndoExpiryResult> {
  override readonly workerName = 'UndoExpiryWorker';
  override readonly policy = 'cronPolicy' as const;

  /**
   * Lag past `expires_at` before a row is eligible for deletion.
   * Documented in the class header — see the 410-vs-404 boundary
   * argument and the cleanup-outage tolerance.
   */
  static readonly EXPIRY_LAG_DAYS = 1;

  constructor(private readonly deps: { db: WorkerDb }) {
    super();
  }

  /**
   * D225 cron idempotency key — `(worker_name, scheduled_at_minute)`.
   * Repeated enqueues for the same minute are deduped by BullMQ's
   * `jobId` (set in the queue helper).
   */
  protected override getIdempotencyKey(payload: UndoExpiryJobData): string {
    return `${this.workerName}:${payload.scheduledAtMinute}`;
  }

  override async processJob(
    _payload: UndoExpiryJobData,
    _ctx: WorkerContext,
  ): Promise<UndoExpiryResult> {
    const startedAt = Date.now();
    // `expires_at < now() - interval '1 day'` — see EXPIRY_LAG_DAYS
    // doc in the class header.
    const deleted = await this.deps.db
      .delete(undoJournal)
      .where(lt(undoJournal.expiresAt, sql`now() - interval '1 day'`))
      .returning({ token: undoJournal.token });

    return {
      deleted: deleted.length,
      durationMs: Date.now() - startedAt,
    };
  }
}
