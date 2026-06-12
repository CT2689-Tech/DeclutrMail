import type { JobsOptions, Queue } from 'bullmq';

import { WORKER_POLICIES } from './worker-policies.js';
import { scheduledAtMinute } from './undo-expiry.queue.js';
import type { WatchRenewalJobData } from './watch-renewal.worker.js';

/**
 * BullMQ contract for the Gmail watch-renewal cron (D8, D225, D229).
 *
 * Shared between the producer (the scheduler in the worker composition
 * root that ticks every 6 hours) and the consumer
 * (`WatchRenewalWorker`). Co-locating queue name + job name +
 * idempotency-key encoding keeps producer/consumer from drifting —
 * same pattern as `undo-expiry.queue.ts`.
 */

export const WATCH_RENEWAL_QUEUE = 'watch-renewal';
export const WATCH_RENEWAL_JOB = 'watch-renewal';

/**
 * Period between renewal sweeps — 6 hours (D225: "Runs every 6h").
 *
 * Gmail watch subscriptions expire after ~7 days; `users.watch` on an
 * already-watched mailbox simply extends the expiration, so a 6h
 * cadence keeps every mailbox ~27 renewals ahead of expiry. Even a
 * multi-DAY worker outage cannot let a watch lapse.
 */
export const WATCH_RENEWAL_INTERVAL_MS = 6 * 60 * 60 * 1_000;

/**
 * Build BullMQ options for one renewal enqueue.
 *
 * `jobId` derives from the worker name + scheduling minute (D225 cron
 * idempotency) → BullMQ dedupes a second add for the same minute. The
 * durable second layer is the worker's `cron_runs` claim — see
 * `WatchRenewalWorker.processJob`.
 */
export function watchRenewalJobOptions(scheduledAtMinuteValue: string): JobsOptions {
  const policy = WORKER_POLICIES.cronPolicy;
  return {
    jobId: `WatchRenewalWorker:${scheduledAtMinuteValue}`,
    attempts: policy.maxAttempts,
    ...(policy.backoff
      ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } }
      : {}),
    removeOnComplete: { age: 24 * 60 * 60 }, // 24h retention for one-tick debug.
    removeOnFail: false,
  };
}

/**
 * Enqueue one renewal sweep. Idempotent on `scheduledAtMinute` — safe
 * to call from a setInterval driver + a boot enqueue without
 * coordination (BullMQ ignores the duplicate jobId).
 */
export async function enqueueWatchRenewalTick(
  queue: Queue<WatchRenewalJobData>,
  now: Date = new Date(),
): Promise<void> {
  const minute = scheduledAtMinute(now);
  await queue.add(WATCH_RENEWAL_JOB, { scheduledAtMinute: minute }, watchRenewalJobOptions(minute));
}
