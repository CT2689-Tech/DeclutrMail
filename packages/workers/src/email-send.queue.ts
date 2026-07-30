import type { JobsOptions, Queue } from 'bullmq';

import { WORKER_POLICIES } from './worker-policies.js';
import type { EmailSendJobData, EmailSendResult } from './email-send.worker.js';

/**
 * BullMQ contract for the transactional-email pipeline (D162, D225).
 *
 * Shared between producers (the outbox sync-ready trigger in
 * `apps/api/src/notifications/`, U22's deletion flow) and the consumer
 * (`EmailSendWorker`). Co-locating queue name + jobId encodings here
 * keeps producers and the worker from drifting on dedup semantics.
 *
 * Idempotency model — ONE SEND PER LOGICAL EVENT:
 *   - The BullMQ `jobId` dedups enqueues, but on the job's RECORDED
 *     OUTCOME rather than its mere existence — see `enqueueEmailSend`
 *     for why the state alone is the wrong signal in both directions.
 *   - The job's `idempotencyKey` (set to the same value) is forwarded
 *     to Resend as the `Idempotency-Key` header, so a BullMQ RETRY of
 *     the same job cannot double-send. That protection is scoped to the
 *     provider's key-retention window, so it covers in-job retries and
 *     must not be leaned on to justify re-adding a job days later.
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
 * ## Suppress only when the email demonstrably WENT OUT
 *
 * The question this dedup must answer is "did this email already send?"
 * BullMQ's job state is a proxy for that, and it is wrong in BOTH
 * directions — which is how two separate bugs hid here (Codex
 * stop-reviews, 2026-07-29):
 *
 *   - `completed` does NOT mean sent. Four outcomes complete without
 *     delivering anything (`skipped_opted_out`, `skipped_user_returned`,
 *     `skipped_suppressed`, `skipped_no_recipient`). Suppressing on
 *     `completed` alone buried a legitimate later send: a user with
 *     reminders off completes as `skipped_opted_out`, and after they turn
 *     reminders back on nothing could be enqueued for that mailbox.
 *
 *   - `failed` does NOT mean not-sent. A `transient` failure can mean
 *     Resend accepted the request and the confirmation was lost; if every
 *     attempt fails that way the job is `failed` with the mail delivered.
 *     An earlier revision reaped failed jobs and claimed the provider
 *     `Idempotency-Key` made that safe — it does not, because that key
 *     has a finite retention window and the reminder's own 24h delay
 *     lands a re-add right at its edge.
 *
 * So the decision is made on the RECORDED OUTCOME, which the worker
 * writes as the job's return value and which cannot be ambiguous — it
 * says whether `deliver()` confirmed:
 *
 *   - completed + `sent`      → noop. The mail exists; this is the real
 *                               dedup window doing its job.
 *   - completed + `skipped_*` → reap and re-add. Nothing was delivered
 *                               and we KNOW it, so a fresh enqueue is a
 *                               legitimate new attempt, not a duplicate.
 *   - `failed`                → noop. Delivery may have happened, and
 *                               duplicating a real email is worse than a
 *                               missed one. Nothing manufactures failed
 *                               jobs for merely-refused sends any more:
 *                               the postal gate returns
 *                               `skipped_no_postal_address` precisely so
 *                               it lands in the reapable branch above.
 *   - `unknown`               → reap and re-add. The hash was evicted
 *                               (Redis flush, TTL, failover) so BullMQ
 *                               can no longer schedule it. Suppressing
 *                               strands the send forever for no benefit.
 *   - live states             → noop, or a redelivered event stacks a
 *                               second send beside the pending one.
 *
 * `ensureInitialSyncJob` reaps `completed` outright, and copying that
 * here would double-send — re-running a sync is idempotent, re-sending
 * an email is not.
 */
export async function enqueueEmailSend(
  queue: Queue<EmailSendJobData>,
  data: EmailSendJobData,
  delayMs = 0,
): Promise<'added' | 'noop'> {
  const existing = await queue.getJob(data.idempotencyKey);
  if (existing) {
    const state = await existing.getState();
    const reapable =
      state === 'unknown' || (state === 'completed' && !didSend(existing.returnvalue));
    if (!reapable) {
      return 'noop';
    }
    // `remove()` REJECTS if a worker locked the job between `getState()`
    // and here. Treat that lost race as a no-op rather than adding under
    // a half-removed hash — the attempt that won the race runs, and a
    // later enqueue reconsiders it.
    try {
      await existing.remove();
    } catch {
      return 'noop';
    }
  }
  await queue.add(EMAIL_SEND_JOB, data, emailSendJobOptions(data.idempotencyKey, delayMs));
  return 'added';
}

/**
 * Whether each recorded outcome means the mail actually went out.
 *
 * A total Record rather than a set of "skip" strings, so adding an
 * outcome to `EmailSendResult['outcome']` fails TYPECHECK until it is
 * classified here. Forgetting to classify one would otherwise silently
 * decide whether a duplicate email is allowed — exactly the kind of
 * omission that should not compile.
 */
const DELIVERED_BY_OUTCOME: Record<EmailSendResult['outcome'], boolean> = {
  sent: true,
  skipped_user_returned: false,
  skipped_opted_out: false,
  skipped_suppressed: false,
  skipped_no_recipient: false,
  skipped_no_postal_address: false,
  skipped_delivery_disabled: false,
  skipped_delivery_rejected: false,
};

/**
 * Did a completed job's recorded outcome confirm a delivery?
 *
 * Fails CLOSED: anything unreadable — absent, a JSON string from an older
 * BullMQ, an outcome this build does not know — counts as delivered, so a
 * record we cannot parse never authorises a duplicate. Being wrong that
 * way costs one missed send; being wrong the other way sends a real
 * person a second copy.
 */
function didSend(returnvalue: unknown): boolean {
  let raw: unknown = returnvalue;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return true;
    }
  }
  if (raw === null || typeof raw !== 'object') {
    return true;
  }
  const outcome = (raw as { outcome?: unknown }).outcome;
  if (typeof outcome !== 'string' || !(outcome in DELIVERED_BY_OUTCOME)) {
    return true;
  }
  return DELIVERED_BY_OUTCOME[outcome as EmailSendResult['outcome']];
}
