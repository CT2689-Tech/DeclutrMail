import type { JobsOptions, Queue } from 'bullmq';

import { WORKER_POLICIES } from './worker-policies.js';
import { scheduledAtMinute } from './undo-expiry.queue.js';
import type { BillingVerdictJobData } from './billing-verdict.worker.js';

/**
 * BullMQ contract for the billing-verdict cron (D253, D249, D225).
 *
 * Shared between the producer (the scheduler in the worker composition
 * root that ticks every 10 minutes) and the consumer
 * (`BillingVerdictWorker`). Co-locating queue name + job name +
 * idempotency-key encoding keeps producer/consumer from drifting —
 * same pattern as `watch-renewal.queue.ts`.
 */

export const BILLING_VERDICT_QUEUE = 'billing-verdict';
export const BILLING_VERDICT_JOB = 'billing-verdict';

/**
 * Period between verdict passes — 10 minutes.
 *
 * Refund/chargeback enforcement used to ride the 6-hourly billing drift
 * sweep. Once a refunded customer's repurchase depends on that pass
 * having run (D253), 6h is a revenue-path outage: the customer wants to
 * pay us again and cannot. 10 minutes is short enough that a repurchase
 * attempt is a wait, not a lockout, and the pass itself is a cheap
 * convergence loop — it only touches subscription rows still carrying a
 * `refund`/`chargeback` verdict, and stops sending once the provider
 * confirms.
 */
export const BILLING_VERDICT_INTERVAL_MS = 10 * 60 * 1_000;

/**
 * Build BullMQ options for one verdict enqueue.
 *
 * `jobId` derives from the worker name + scheduling minute (D225 cron
 * idempotency) → BullMQ dedupes a second add for the same minute. The
 * durable second layer is the worker's `cron_runs` claim — see
 * `BillingVerdictWorker.processJob`.
 */
export function billingVerdictJobOptions(scheduledAtMinuteValue: string): JobsOptions {
  const policy = WORKER_POLICIES.cronPolicy;
  return {
    jobId: `BillingVerdictWorker:${scheduledAtMinuteValue}`,
    attempts: policy.maxAttempts,
    ...(policy.backoff
      ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } }
      : {}),
    removeOnComplete: { age: 24 * 60 * 60 }, // 24h retention for one-tick debug.
    removeOnFail: false,
  };
}

/**
 * Enqueue one verdict pass. Idempotent on `scheduledAtMinute` — safe to
 * call from a setInterval driver + a boot enqueue without coordination
 * (BullMQ ignores the duplicate jobId).
 */
export async function enqueueBillingVerdictTick(
  queue: Queue<BillingVerdictJobData>,
  now: Date = new Date(),
): Promise<void> {
  const minute = scheduledAtMinute(now);
  await queue.add(
    BILLING_VERDICT_JOB,
    { scheduledAtMinute: minute },
    billingVerdictJobOptions(minute),
  );
}
