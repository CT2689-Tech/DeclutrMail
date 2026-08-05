import type { JobsOptions, Queue } from 'bullmq';

import { WORKER_POLICIES } from './worker-policies.js';
import type { WeeklyValueReceiptJobData } from './weekly-value-receipt.worker.js';

export const WEEKLY_VALUE_RECEIPT_QUEUE = 'weekly-value-receipt';
export const WEEKLY_VALUE_RECEIPT_JOB = 'weekly-value-receipt';
export const WEEKLY_VALUE_RECEIPT_INTERVAL_MS = 60 * 60 * 1_000;

function scheduledAtMinute(now: Date): string {
  return now.toISOString().slice(0, 16);
}

export function weeklyValueReceiptJobOptions(minute: string): JobsOptions {
  const policy = WORKER_POLICIES.cronPolicy;
  return {
    jobId: `WeeklyValueReceiptWorker:${minute}`,
    attempts: policy.maxAttempts,
    ...(policy.backoff
      ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } }
      : {}),
    removeOnComplete: { age: 24 * 60 * 60 },
    removeOnFail: false,
  };
}

/** Hourly tick; the worker resolves each user's Sunday 18:00 local window. */
export async function enqueueWeeklyValueReceiptTick(
  queue: Queue<WeeklyValueReceiptJobData>,
  now: Date = new Date(),
): Promise<void> {
  const minute = scheduledAtMinute(now);
  await queue.add(
    WEEKLY_VALUE_RECEIPT_JOB,
    { scheduledAtMinute: minute },
    weeklyValueReceiptJobOptions(minute),
  );
}
