import type { JobsOptions, Queue } from 'bullmq';

import { WORKER_POLICIES } from './worker-policies.js';
import type { SenderIndexSweepJobData } from './sender-index-sweep.worker.js';

/**
 * BullMQ contract for the nightly sender-index sweep (D245, D159).
 *
 * Shared between the producer (the scheduler in the worker composition
 * root) and the consumer (`SenderIndexSweepWorker`). Co-locating queue
 * name + job name + idempotency-key encoding here keeps producer and
 * consumer from drifting — the same pattern as
 * `senders-counter-reconciliation.queue.ts`.
 */

export const SENDER_INDEX_SWEEP_QUEUE = 'sender-index-sweep';
export const SENDER_INDEX_SWEEP_JOB = 'sender-index-sweep';

/**
 * Period between sweeps — 24h.
 *
 * This is the cadence at which a CLOCK-driven protection change is
 * noticed (a star ageing past 365 days) and at which `volume` /
 * `read_count` drift closes. Both were previously recomputed on every
 * Pub/Sub push, which bought a latency the product never needed: the
 * counters feed scoring and Autopilot, and the UI reads
 * `mail_messages` live, so no user-visible number waits on this.
 *
 * Nightly is also what makes the per-push work cheap enough to stop
 * blocking user actions — see `applyAutomaticProtection`'s scope note.
 * Tighten via this constant if drift trends surface a problem.
 */
export const SENDER_INDEX_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1_000;

/**
 * Round a Date down to its minute boundary in ISO-8601 form
 * (`YYYY-MM-DDTHH:MM`). The D225 cron idempotency key — paired with the
 * worker name it dedupes concurrent enqueues for the same scheduling
 * minute. Same key shape as every other cron worker here.
 */
export function scheduledAtMinute(now: Date = new Date()): string {
  const iso = now.toISOString(); // 2026-08-24T03:00:12.345Z
  return iso.slice(0, 16); // 2026-08-24T03:00
}

/**
 * Build BullMQ options for one sweep enqueue.
 *
 * `jobId` derives from the worker name + scheduling minute → BullMQ
 * dedupes a second add for the same minute. Combined with the worker
 * class's `getIdempotencyKey`, the cron cannot run twice for the same
 * minute under any race.
 */
export function senderIndexSweepJobOptions(scheduledAtMinuteValue: string): JobsOptions {
  const policy = WORKER_POLICIES.cronPolicy;
  return {
    jobId: `SenderIndexSweepWorker:${scheduledAtMinuteValue}`,
    attempts: policy.maxAttempts,
    ...(policy.backoff
      ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } }
      : {}),
    removeOnComplete: { age: 24 * 60 * 60 }, // 24h retention for one-tick debug.
    removeOnFail: false,
  };
}

/**
 * Enqueue one sweep tick.
 *
 * Idempotent on `scheduledAtMinute` — safe to call from a setInterval
 * driver without coordination.
 */
export async function enqueueSenderIndexSweepTick(
  queue: Queue<SenderIndexSweepJobData>,
  now: Date = new Date(),
): Promise<void> {
  const minute = scheduledAtMinute(now);
  await queue.add(
    SENDER_INDEX_SWEEP_JOB,
    { scheduledAtMinute: minute },
    senderIndexSweepJobOptions(minute),
  );
}
