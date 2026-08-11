import type { JobsOptions, Queue } from 'bullmq';

import { WORKER_POLICIES } from './worker-policies.js';
import type { LapseReengagementJobData } from './lapse-reengagement.worker.js';

export const LAPSE_REENGAGEMENT_QUEUE = 'lapse-reengagement';
export const LAPSE_REENGAGEMENT_JOB = 'lapse-reengagement';
export const LAPSE_REENGAGEMENT_INTERVAL_MS = 60 * 60 * 1_000;

function scheduledAtMinute(now: Date): string {
  return now.toISOString().slice(0, 16);
}

export function lapseReengagementJobOptions(minute: string): JobsOptions {
  const policy = WORKER_POLICIES.cronPolicy;
  return {
    jobId: `LapseReengagementWorker:${minute}`,
    attempts: policy.maxAttempts,
    ...(policy.backoff
      ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } }
      : {}),
    removeOnComplete: { age: 24 * 60 * 60 },
    removeOnFail: false,
  };
}

/** Hourly tick; the worker resolves each user's dormancy band (D126 Part 3). */
export async function enqueueLapseReengagementTick(
  queue: Queue<LapseReengagementJobData>,
  now: Date = new Date(),
): Promise<void> {
  const minute = scheduledAtMinute(now);
  await queue.add(
    LAPSE_REENGAGEMENT_JOB,
    { scheduledAtMinute: minute },
    lapseReengagementJobOptions(minute),
  );
}
