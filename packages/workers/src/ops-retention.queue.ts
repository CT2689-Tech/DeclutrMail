import type { JobsOptions, Queue } from 'bullmq';

import { WORKER_POLICIES } from './worker-policies.js';
import type { OpsRetentionJobData } from './ops-retention.worker.js';

/**
 * BullMQ contract for the daily ops-table retention sweep (D225, D159).
 *
 * Shared between the producer (the scheduler in the worker composition
 * root) and the consumer (`OpsRetentionWorker`) — same shape as
 * `sender-index-sweep.queue.ts`.
 */

export const OPS_RETENTION_QUEUE = 'ops-retention';
export const OPS_RETENTION_JOB = 'ops-retention';

/**
 * Period between passes — 24h.
 *
 * Nothing reads these tables on a latency budget: `cron_runs` past the
 * window is unreadable by the idempotency gate and unwanted by the
 * watchdog, and a dead-letter row past 90 days is archaeology. Daily is
 * frequent enough that the batch ceiling drains a normal backlog on the
 * first pass and rare enough to cost nothing.
 */
export const OPS_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1_000;

/**
 * Round a Date down to its minute boundary (`YYYY-MM-DDTHH:MM`) — the
 * D225 cron idempotency key.
 */
export function opsRetentionScheduledAtMinute(now: Date = new Date()): string {
  return now.toISOString().slice(0, 16);
}

export function opsRetentionJobOptions(scheduledAtMinuteValue: string): JobsOptions {
  const policy = WORKER_POLICIES.cronPolicy;
  return {
    jobId: `OpsRetentionWorker:${scheduledAtMinuteValue}`,
    attempts: policy.maxAttempts,
    ...(policy.backoff
      ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } }
      : {}),
    removeOnComplete: { age: 24 * 60 * 60 },
    removeOnFail: false,
  };
}

/** Enqueue one retention tick. Idempotent on the scheduling minute. */
export async function enqueueOpsRetentionTick(
  queue: Queue<OpsRetentionJobData>,
  now: Date = new Date(),
): Promise<void> {
  const minute = opsRetentionScheduledAtMinute(now);
  await queue.add(OPS_RETENTION_JOB, { scheduledAtMinute: minute }, opsRetentionJobOptions(minute));
}
