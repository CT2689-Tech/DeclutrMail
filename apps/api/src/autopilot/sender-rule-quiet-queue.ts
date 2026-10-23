import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import {
  LABEL_ACTION_QUEUE,
  labelActionJobOptions,
  type LabelActionJobData,
} from '@declutrmail/workers';

/** Each deferral needs a distinct delivery, including extensions within one minute. */
export function senderRuleQuietResume(queue: Pick<Queue<LabelActionJobData>, 'add'>) {
  return async (payload: LabelActionJobData, delayMs: number): Promise<void> => {
    await queue.add(LABEL_ACTION_QUEUE, payload, {
      ...labelActionJobOptions(payload.idempotencyKey),
      jobId: `${payload.actionId}-quiet-${randomUUID()}`,
      delay: Math.max(1000, Math.ceil(delayMs)),
    });
  };
}
