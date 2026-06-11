import type { JobsOptions, Queue } from 'bullmq';

import { WORKER_POLICIES } from './worker-policies.js';
import type { DeadLetterSweepJobData } from './dead-letter.worker.js';

/**
 * BullMQ contract for the dead-letter sweep (D225).
 *
 * Shared between the producer (the setInterval scheduler in the worker
 * composition root) and the consumer (`DeadLetterWorker`). Co-locating
 * queue name + job name + idempotency-key encoding here keeps
 * producer/consumer from drifting.
 */

export const DEAD_LETTER_QUEUE = 'dead-letter';
export const DEAD_LETTER_JOB = 'dead-letter-sweep';

/**
 * Period between sweeps — 60s per D225 ("polls `dead_letter_jobs`
 * every 60s"). The sweep is one indexed SELECT against the partial
 * unreplayed index; a missed tick just delays the alert by a minute.
 */
export const DEAD_LETTER_INTERVAL_MS = 60 * 1_000;

/**
 * Round a Date down to its minute boundary (`YYYY-MM-DDTHH:MM`). The
 * D225 idempotency key — paired with the worker name it dedupes
 * concurrent enqueues for the same scheduling minute. With a 60s
 * interval this yields exactly one sweep per minute even with two
 * scheduler replicas.
 */
export function scheduledAtMinute(now: Date = new Date()): string {
  const iso = now.toISOString();
  return iso.slice(0, 16);
}

export function deadLetterJobOptions(scheduledAtMinuteValue: string): JobsOptions {
  // adminPolicy: maxAttempts 1, no backoff (the next minute's sweep is
  // the retry), so no backoff option is set here.
  const policy = WORKER_POLICIES.adminPolicy;
  return {
    jobId: `DeadLetterWorker:${scheduledAtMinuteValue}`,
    attempts: policy.maxAttempts,
    removeOnComplete: { age: 24 * 60 * 60 },
    removeOnFail: false,
  };
}

/**
 * Enqueue one sweep tick. Idempotent on `scheduledAtMinute` — safe to
 * call from a setInterval driver without coordination.
 */
export async function enqueueDeadLetterTick(
  queue: Queue<DeadLetterSweepJobData>,
  now: Date = new Date(),
): Promise<void> {
  const minute = scheduledAtMinute(now);
  await queue.add(DEAD_LETTER_JOB, { scheduledAtMinute: minute }, deadLetterJobOptions(minute));
}
