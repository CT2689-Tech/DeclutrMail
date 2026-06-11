import type { JobsOptions, Queue } from 'bullmq';

import { WORKER_POLICIES } from './worker-policies.js';
import type { EmailSendJobData } from './email-send.worker.js';

/**
 * BullMQ contract for the transactional-email pipeline (D162, D225).
 *
 * Shared between producers (the outbox sync-ready trigger in
 * `apps/api/src/notifications/`, U22's deletion flow) and the consumer
 * (`EmailSendWorker`). Co-locating queue name + jobId encodings here
 * keeps producers and the worker from drifting on dedup semantics.
 *
 * Idempotency model — ONE SEND PER LOGICAL EVENT:
 *   - The BullMQ `jobId` dedups enqueues (a redelivered outbox event
 *     cannot create a second job while the first is live or within the
 *     removeOnComplete window).
 *   - The job's `idempotencyKey` (set to the same value) is forwarded
 *     to Resend as the `Idempotency-Key` header, so even a BullMQ
 *     retry after a sent-but-crashed attempt cannot double-send.
 *
 * jobId encodings use `__` separators — BullMQ ≥5.77 rejects ':' in
 * jobIds (see `incrementalSyncJobOptions`).
 */

export const EMAIL_SEND_QUEUE = 'email-send';
export const EMAIL_SEND_JOB = 'email-send';

/** Delay before the "you haven't come back" reminder fires (D6). */
export const SYNC_REMINDER_DELAY_MS = 24 * 60 * 60 * 1_000;

/**
 * Sync-complete send — keyed on the OUTBOX EVENT id, not the mailbox:
 * the logical event is "this sync_ready event happened". A redelivered
 * event dedups; a genuinely new sync_ready for the same mailbox (e.g.
 * reconnect → fresh initial sync) sends again, which is correct.
 */
export function syncCompleteEmailJobId(eventId: string): string {
  return `email__sync-complete__${eventId}`;
}

/**
 * 24h reminder — keyed PER MAILBOX (spec: one pending reminder per
 * mailbox). While one reminder is queued/delayed, a redelivered or
 * duplicate sync_ready cannot stack a second.
 */
export function syncReminderEmailJobId(mailboxAccountId: string): string {
  return `email__sync-reminder-24h__${mailboxAccountId}`;
}

/** Job options for any email send. `delayMs` schedules the reminder. */
export function emailSendJobOptions(jobId: string, delayMs = 0): JobsOptions {
  const policy = WORKER_POLICIES.batchPolicy;
  return {
    jobId,
    ...(delayMs > 0 ? { delay: delayMs } : {}),
    attempts: policy.maxAttempts,
    ...(policy.backoff
      ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } }
      : {}),
    // Keep completed jobs 7 days so the jobId dedup window comfortably
    // covers outbox redelivery AND the 24h reminder horizon.
    removeOnComplete: { age: 7 * 24 * 60 * 60 },
    removeOnFail: false,
  };
}

/**
 * Enqueue one email send. Idempotent on `data.idempotencyKey` (used as
 * the BullMQ jobId) — safe to call from an at-least-once outbox
 * consumer without coordination.
 */
export async function enqueueEmailSend(
  queue: Queue<EmailSendJobData>,
  data: EmailSendJobData,
  delayMs = 0,
): Promise<'added' | 'noop'> {
  const existing = await queue.getJob(data.idempotencyKey);
  if (existing) {
    return 'noop';
  }
  await queue.add(EMAIL_SEND_JOB, data, emailSendJobOptions(data.idempotencyKey, delayMs));
  return 'added';
}
