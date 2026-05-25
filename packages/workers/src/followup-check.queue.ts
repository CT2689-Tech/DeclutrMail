import type { JobsOptions, Queue } from 'bullmq';

import { WORKER_POLICIES } from './worker-policies.js';
import type { FollowupCheckJobData } from './followup-check.worker.js';

/**
 * BullMQ contract for the followup-tracker materialization cron
 * (D84, D85, D87, D88).
 *
 * Shared between the producer (the scheduler in the worker composition
 * root) and the consumer (`FollowupCheckWorker`). Co-locating queue
 * name + idempotency key encoding here keeps producer/consumer from
 * drifting.
 */

export const FOLLOWUP_CHECK_QUEUE = 'followup-check';
export const FOLLOWUP_CHECK_JOB = 'followup-check';

/**
 * Period between followup sweeps — 6 hours (per D87).
 *
 * The sweep is bounded: one window-function query per mailbox over
 * messages from the last 60 days. 6 hours is the D-decision cadence —
 * timely enough that the UI doesn't feel stale, sparse enough that
 * we're not hammering the DB at launch scale.
 */
export const FOLLOWUP_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

/**
 * Round a Date down to its minute boundary in ISO-8601 form
 * (`YYYY-MM-DDTHH:MM`). The D225 cron idempotency key — paired with
 * the worker name it dedupes concurrent enqueues for the same
 * scheduling minute.
 */
export function scheduledAtMinute(now: Date = new Date()): string {
  const iso = now.toISOString();
  return iso.slice(0, 16);
}

export function followupCheckJobOptions(scheduledAtMinuteValue: string): JobsOptions {
  const policy = WORKER_POLICIES.cronPolicy;
  return {
    jobId: `FollowupCheckWorker:${scheduledAtMinuteValue}`,
    attempts: policy.maxAttempts,
    ...(policy.backoff
      ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } }
      : {}),
    removeOnComplete: { age: 24 * 60 * 60 },
    removeOnFail: false,
  };
}

/**
 * Enqueue one followup-tracker sweep. Idempotent on `scheduledAtMinute`
 * — safe to call from a setInterval driver without coordination.
 */
export async function enqueueFollowupCheckTick(
  queue: Queue<FollowupCheckJobData>,
  now: Date = new Date(),
): Promise<void> {
  const minute = scheduledAtMinute(now);
  await queue.add(
    FOLLOWUP_CHECK_JOB,
    { scheduledAtMinute: minute },
    followupCheckJobOptions(minute),
  );
}
