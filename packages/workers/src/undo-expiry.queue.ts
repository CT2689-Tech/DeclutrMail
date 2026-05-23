import type { JobsOptions, Queue } from 'bullmq';

import { WORKER_POLICIES } from './worker-policies.js';
import type { UndoExpiryJobData } from './undo-expiry.worker.js';

/**
 * BullMQ contract for the undo-journal cleanup cron (D35, D58, D232).
 *
 * Shared between the producer (the scheduler in the worker composition
 * root that ticks every 5 minutes) and the consumer (`UndoExpiryWorker`).
 * Co-locating queue name + job name + idempotency-key encoding here
 * keeps producer/consumer from drifting.
 */

export const UNDO_EXPIRY_QUEUE = 'undo-expiry';
export const UNDO_EXPIRY_JOB = 'undo-expiry';

/**
 * Period between cleanup passes — 5 minutes.
 *
 * The cleanup is cheap (one bounded DELETE; the WHERE column is the
 * leading edge of `undo_journal_account_expires_idx` so Postgres can
 * use it). 5 minutes is the task spec; the 1-day deletion lag inside
 * the worker (see `UndoExpiryWorker.EXPIRY_LAG_DAYS`) absorbs any
 * missed ticks during an outage.
 */
export const UNDO_EXPIRY_INTERVAL_MS = 5 * 60 * 1_000;

/**
 * Round a Date down to its minute boundary in ISO-8601 form
 * (`YYYY-MM-DDTHH:MM`). This is the D225 cron idempotency key — paired
 * with the worker name it dedupes concurrent enqueues for the same
 * scheduling minute.
 */
export function scheduledAtMinute(now: Date = new Date()): string {
  const iso = now.toISOString(); // 2026-05-23T14:35:12.345Z
  return iso.slice(0, 16); // 2026-05-23T14:35
}

/**
 * Build BullMQ options for one cleanup enqueue.
 *
 * `jobId` derives from the worker name + scheduling minute → BullMQ
 * dedupes a second add for the same minute. Combined with the worker
 * class's `getIdempotencyKey`, the cron job cannot run twice for the
 * same minute under any race.
 */
export function undoExpiryJobOptions(scheduledAtMinuteValue: string): JobsOptions {
  const policy = WORKER_POLICIES.cronPolicy;
  return {
    jobId: `UndoExpiryWorker:${scheduledAtMinuteValue}`,
    attempts: policy.maxAttempts,
    ...(policy.backoff
      ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } }
      : {}),
    removeOnComplete: { age: 24 * 60 * 60 }, // 24h retention for one-tick debug.
    removeOnFail: false,
  };
}

/**
 * Enqueue one cleanup tick.
 *
 * Idempotent on `scheduledAtMinute` — safe to call from a setInterval
 * driver without coordination. Returns the BullMQ Job (or null when
 * BullMQ rejected the add as a duplicate of an existing minute).
 */
export async function enqueueUndoExpiryTick(
  queue: Queue<UndoExpiryJobData>,
  now: Date = new Date(),
): Promise<void> {
  const minute = scheduledAtMinute(now);
  await queue.add(UNDO_EXPIRY_JOB, { scheduledAtMinute: minute }, undoExpiryJobOptions(minute));
}
