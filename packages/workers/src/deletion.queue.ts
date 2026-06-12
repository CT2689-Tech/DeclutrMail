import type { JobsOptions, Queue } from 'bullmq';

import { WORKER_POLICIES } from './worker-policies.js';
import { scheduledAtMinute } from './undo-expiry.queue.js';
import type { DeletionSweepJobData } from './deletion.worker.js';

/**
 * BullMQ contract for the account-deletion purge sweep (D205, D216,
 * D232, D225 cronPolicy).
 *
 * Shared between the producer (the scheduler in the worker composition
 * root) and the consumer (`AccountDeletionPurgeWorker`). Same
 * co-location pattern as `watch-renewal.queue.ts`.
 *
 * Cadence: every 5 minutes. The sweep's due-scan is one indexed query
 * (`account_deletion_requests_due_scan_idx` partial index) so an idle
 * tick is nearly free, and a `DELETE AND WAIVE UNDO` immediate request
 * (effective_at = now) purges within ≤5 minutes of the typed waiver —
 * "immediate" in product terms.
 */

export const DELETION_SWEEP_QUEUE = 'deletion-sweep';
export const DELETION_SWEEP_JOB = 'deletion-sweep';

/** Period between purge sweeps — 5 minutes. */
export const DELETION_SWEEP_INTERVAL_MS = 5 * 60 * 1_000;

/**
 * Build BullMQ options for one sweep enqueue. `jobId` derives from the
 * worker name + scheduling minute (D225 cron idempotency); the durable
 * second layer is the worker's `cron_runs` claim.
 */
export function deletionSweepJobOptions(scheduledAtMinuteValue: string): JobsOptions {
  const policy = WORKER_POLICIES.cronPolicy;
  return {
    jobId: `AccountDeletionPurgeWorker:${scheduledAtMinuteValue}`,
    attempts: policy.maxAttempts,
    ...(policy.backoff
      ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } }
      : {}),
    removeOnComplete: { age: 24 * 60 * 60 }, // 24h retention for one-tick debug.
    removeOnFail: false,
  };
}

/**
 * Enqueue one purge sweep. Idempotent on `scheduledAtMinute` — safe to
 * call from a setInterval driver + a boot enqueue without coordination
 * (BullMQ ignores the duplicate jobId).
 */
export async function enqueueDeletionSweepTick(
  queue: Queue<DeletionSweepJobData>,
  now: Date = new Date(),
): Promise<void> {
  const minute = scheduledAtMinute(now);
  await queue.add(
    DELETION_SWEEP_JOB,
    { scheduledAtMinute: minute },
    deletionSweepJobOptions(minute),
  );
}
