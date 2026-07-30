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

/**
 * Sync-FAILED notice — keyed per mailbox per UTC day. Event-id keying
 * would email every distinct terminal failure, and a user hammering the
 * new retry against a broken mailbox can produce one every few minutes;
 * mailbox-only keying would suppress a genuinely new failure next week
 * once the old job ages out unpredictably. Per-day is deterministic:
 * at most one failure notice per mailbox per day, however many retries
 * fail behind it.
 */
export function syncFailedEmailJobId(mailboxAccountId: string, failedAtIso: string): string {
  return `email__sync-failed__${mailboxAccountId}__${failedAtIso.slice(0, 10)}`;
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
 *
 * ## A failed job must not suppress a re-enqueue
 *
 * `removeOnFail: false` keeps failed jobs forever, and these jobIds are
 * permanent per logical event — the 24h reminder's is keyed per MAILBOX,
 * with nothing that ever re-derives it. So a bare `if (existing) return
 * 'noop'` let ONE terminal failure bury that email for good: every later
 * enqueue no-ops and no configuration change revives it.
 *
 * Observed with the CAN-SPAM postal refusal (Codex stop-review
 * 2026-07-29): a mailbox whose reminder failed for a missing address
 * could never receive a reminder again, even after the address was set.
 * Proven against dev Redis — `getJob` returned the failed job and the
 * enqueue no-oped. "Set the address and reminders resume" was false.
 *
 * The dedup window exists to prevent DUPLICATE sends, not to permanently
 * bury an email that never sent. So the state, not mere existence,
 * decides — the same correction `ensureInitialSyncJob` already carries
 * for initial sync (see queue.ts), which this function had drifted from.
 *
 * `completed` still suppresses, and that difference from the sync case
 * is the point: for email, completed means the message WAS sent, so the
 * `removeOnComplete` age IS the dedup window. Reaping it would
 * double-send.
 *
 * `failed` and `unknown` do not suppress. `unknown` means the job hash
 * was evicted (Redis flush, TTL, failover) so BullMQ can no longer
 * schedule it; treating that as live stranded the send forever. Neither
 * state can double-send in practice: the same value rides to Resend as
 * `Idempotency-Key`, which covers even the sent-then-crashed case.
 */
export async function enqueueEmailSend(
  queue: Queue<EmailSendJobData>,
  data: EmailSendJobData,
  delayMs = 0,
): Promise<'added' | 'noop'> {
  const existing = await queue.getJob(data.idempotencyKey);
  if (existing) {
    const state = await existing.getState();
    if (state !== 'failed' && state !== 'unknown') {
      return 'noop';
    }
    // `remove()` REJECTS if a worker locked the job between `getState()`
    // and here. Treat that lost race as a no-op rather than adding under
    // a half-removed hash — the attempt that won the race runs, and a
    // later enqueue reaps it if it fails again.
    try {
      await existing.remove();
    } catch {
      return 'noop';
    }
  }
  await queue.add(EMAIL_SEND_JOB, data, emailSendJobOptions(data.idempotencyKey, delayMs));
  return 'added';
}
