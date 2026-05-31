import type { JobsOptions, Queue } from 'bullmq';

import { WORKER_POLICIES } from './worker-policies.js';
import type { SendersCounterReconciliationJobData } from './senders-counter-reconciliation.worker.js';

/**
 * BullMQ contract for the senders-counter reconciliation cron
 * (ADR-0014 §"Reconciliation & drift", D159).
 *
 * Shared between the producer (the scheduler in the worker composition
 * root that ticks nightly) and the consumer
 * (`SendersCounterReconciliationWorker`). Co-locating queue name + job
 * name + idempotency-key encoding here keeps producer/consumer from
 * drifting (the same pattern as `undo-expiry.queue.ts`).
 */

export const SENDERS_COUNTER_RECONCILIATION_QUEUE = 'senders-counter-reconciliation';
export const SENDERS_COUNTER_RECONCILIATION_JOB = 'senders-counter-reconciliation';

/**
 * Period between reconciliation passes — 24h (nightly).
 *
 * ADR-0014 §"Reconciliation & drift": "Frequency: nightly is the
 * default; tighter if drift trends above a TBD threshold." A nightly
 * cadence is the right tradeoff today: Path A (full rebuild) ALSO
 * closes drift on every reconnect / OAuth re-grant / resync, so the
 * reconciliation worker is the steady-state safety net rather than the
 * primary source of truth. Tighten via this constant if drift trends
 * surface a problem.
 */
export const SENDERS_COUNTER_RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1_000;

/**
 * Round a Date down to its minute boundary in ISO-8601 form
 * (`YYYY-MM-DDTHH:MM`). The D225 cron idempotency key — paired with the
 * worker name it dedupes concurrent enqueues for the same scheduling
 * minute. Borrowed verbatim from `undo-expiry.queue.ts` to keep the
 * key-shape consistent across cron workers.
 */
export function scheduledAtMinute(now: Date = new Date()): string {
  const iso = now.toISOString(); // 2026-05-29T03:00:12.345Z
  return iso.slice(0, 16); // 2026-05-29T03:00
}

/**
 * Build BullMQ options for one reconciliation enqueue.
 *
 * `jobId` derives from the worker name + scheduling minute → BullMQ
 * dedupes a second add for the same minute. Combined with the worker
 * class's `getIdempotencyKey`, the cron cannot run twice for the same
 * minute under any race.
 */
export function sendersCounterReconciliationJobOptions(
  scheduledAtMinuteValue: string,
): JobsOptions {
  const policy = WORKER_POLICIES.cronPolicy;
  return {
    jobId: `SendersCounterReconciliationWorker:${scheduledAtMinuteValue}`,
    attempts: policy.maxAttempts,
    ...(policy.backoff
      ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } }
      : {}),
    removeOnComplete: { age: 24 * 60 * 60 }, // 24h retention for one-tick debug.
    removeOnFail: false,
  };
}

/**
 * Enqueue one reconciliation tick.
 *
 * Idempotent on `scheduledAtMinute` — safe to call from a setInterval
 * driver without coordination.
 */
export async function enqueueSendersCounterReconciliationTick(
  queue: Queue<SendersCounterReconciliationJobData>,
  now: Date = new Date(),
): Promise<void> {
  const minute = scheduledAtMinute(now);
  await queue.add(
    SENDERS_COUNTER_RECONCILIATION_JOB,
    { scheduledAtMinute: minute },
    sendersCounterReconciliationJobOptions(minute),
  );
}
