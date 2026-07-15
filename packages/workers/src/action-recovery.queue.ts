import type { JobsOptions, Queue } from 'bullmq';

import type { ActionRecoveryJobData } from './action-recovery.worker.js';
import { WORKER_POLICIES } from './worker-policies.js';

/** Read-only verification queue for one Activity recovery preview. */
export const ACTION_RECOVERY_QUEUE = 'action-recovery';
export const ACTION_RECOVERY_JOB = 'action-recovery';

/**
 * One BullMQ job per durable preview. Re-enqueuing the same preview is a
 * transport retry, not a new recovery decision, so the preview id is the
 * complete queue-level idempotency key.
 */
export function actionRecoveryJobOptions(previewId: string): JobsOptions {
  const policy = WORKER_POLICIES.perMailboxPolicy;
  return {
    jobId: `ActionRecoveryWorker-${previewId}`,
    attempts: policy.maxAttempts,
    ...(policy.backoff
      ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } }
      : {}),
    removeOnComplete: { age: 24 * 60 * 60 },
    removeOnFail: false,
  };
}

/** Enqueue one idempotent, read-only provider verification. */
export async function enqueueActionRecoveryPreview(
  queue: Queue<ActionRecoveryJobData>,
  input: ActionRecoveryJobData,
): Promise<void> {
  await queue.add(ACTION_RECOVERY_JOB, input, actionRecoveryJobOptions(input.previewId));
}
