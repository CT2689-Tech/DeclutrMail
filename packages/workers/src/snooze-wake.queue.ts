import type { JobsOptions, Queue } from 'bullmq';

import { WORKER_POLICIES } from './worker-policies.js';
import type { SnoozeWakeJobData } from './snooze-wake.worker.js';

/**
 * BullMQ contract for the snooze-wake pipeline (D78–D80).
 *
 * Shared between the producers (the cron scheduler in the worker
 * composition root + the API's wake-now endpoint) and the consumer
 * (`SnoozeWakeWorker`). Co-locating queue name, idempotency-key
 * encoding, and the Later-label-id mapping keys here keeps the three
 * parties from drifting.
 */

export const SNOOZE_WAKE_QUEUE = 'snooze-wake';
export const SNOOZE_WAKE_JOB = 'snooze-wake';

/**
 * Period between wake sweeps — 15 minutes. Each sweep scans the
 * `sender_policies_snooze_wake_idx` partial index (`snoozed_until <=
 * now()`), so a pass over zero due rows is one cheap indexed query.
 * 15 minutes keeps a wake within a humane window of its scheduled
 * time without per-sender delayed jobs (a due row that fails simply
 * stays due and is retried on the next sweep).
 */
export const SNOOZE_WAKE_INTERVAL_MS = 15 * 60 * 1_000;

/**
 * Round a Date down to its minute boundary in ISO-8601 form
 * (`YYYY-MM-DDTHH:MM`) — the D225 cron idempotency component.
 */
export function snoozeScheduledAtMinute(now: Date = new Date()): string {
  return now.toISOString().slice(0, 16);
}

/**
 * BullMQ job ids must not contain `:` (reserved as BullMQ's Redis key
 * separator) — same normalization the label-action pipeline applies.
 */
function safeJobId(parts: string[]): string {
  return parts.join('-').replace(/:/g, '-');
}

/** Sweep-tick job id — one per scheduling minute (D225). */
export function snoozeSweepJobId(scheduledAtMinute: string): string {
  return safeJobId(['SnoozeWakeWorker', 'sweep', scheduledAtMinute]);
}

/**
 * Targeted wake-now job id — one per (mailbox, sender, minute). A
 * double-clicked Wake button (or a network-retried POST) within the
 * same minute dedups onto one job.
 */
export function snoozeWakeNowJobId(
  mailboxAccountId: string,
  senderKey: string,
  scheduledAtMinute: string,
): string {
  return safeJobId(['SnoozeWakeWorker', 'wake', mailboxAccountId, senderKey, scheduledAtMinute]);
}

export function snoozeWakeJobOptions(jobId: string): JobsOptions {
  const policy = WORKER_POLICIES.cronPolicy;
  return {
    jobId,
    attempts: policy.maxAttempts,
    ...(policy.backoff
      ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } }
      : {}),
    removeOnComplete: { age: 24 * 60 * 60 },
    removeOnFail: false,
  };
}

/**
 * Enqueue one sweep tick. Idempotent on the scheduling minute — safe
 * to call from a `setInterval` driver without coordination.
 */
export async function enqueueSnoozeWakeTick(
  queue: Queue<SnoozeWakeJobData>,
  now: Date = new Date(),
): Promise<void> {
  const minute = snoozeScheduledAtMinute(now);
  await queue.add(
    SNOOZE_WAKE_JOB,
    { kind: 'sweep', scheduledAtMinute: minute },
    snoozeWakeJobOptions(snoozeSweepJobId(minute)),
  );
}

/**
 * Enqueue a targeted wake for one sender (the API's
 * `POST /api/snoozed/:senderId/wake` producer).
 */
export async function enqueueSnoozeWakeNow(
  queue: Queue<SnoozeWakeJobData>,
  input: { mailboxAccountId: string; senderKey: string },
  now: Date = new Date(),
): Promise<void> {
  const minute = snoozeScheduledAtMinute(now);
  await queue.add(
    SNOOZE_WAKE_JOB,
    {
      kind: 'wake',
      mailboxAccountId: input.mailboxAccountId,
      senderKey: input.senderKey,
      scheduledAtMinute: minute,
    },
    snoozeWakeJobOptions(snoozeWakeNowJobId(input.mailboxAccountId, input.senderKey, minute)),
  );
}

// ── Later-label-id mapping (worker → API read path) ──────────────────
//
// The Snoozed LIST endpoint derives "messages currently in Later" from
// the local label mirror (`mail_messages.label_ids`), which stores raw
// Gmail label IDS. Only a Gmail `labels.list` can map the canonical
// label NAME (`DeclutrMail/Later`) to its per-mailbox ID — and the API
// HTTP process deliberately has no Gmail client. So the worker (which
// resolves the id anyway when waking) PUBLISHES the mapping to Redis,
// and the API read path consumes it. The mapping carries a label id
// only — no message data, no PII (D7-safe).
//
// TTL re-resolves the mapping daily so a user-deleted-and-recreated
// label heals within a sweep period; the sweep also refreshes any
// missing key every tick, so a fresh mailbox is queryable ≤15 min
// after its first sweep (in practice: immediately after worker boot).

/** Redis key for a mailbox's resolved DeclutrMail/Later label id. */
export function snoozeLaterLabelKey(mailboxAccountId: string): string {
  return `declutr:snooze:later-label:${mailboxAccountId}`;
}

/** Mapping TTL — 24h (re-resolved by the sweep long before expiry). */
export const SNOOZE_LATER_LABEL_TTL_SECONDS = 24 * 60 * 60;

/**
 * Minimal structural slice of an ioredis client — what the store
 * needs. Keeps `@declutrmail/workers` from depending on ioredis
 * directly (bullmq already carries it; the composition root passes
 * its instance in).
 */
export interface SnoozeLabelMapRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
}

/** Read/write port for the per-mailbox Later-label-id mapping. */
export interface SnoozeLabelMapStore {
  get(mailboxAccountId: string): Promise<string | null>;
  set(mailboxAccountId: string, labelId: string): Promise<void>;
}

/** Redis-backed mapping store — production wiring for both sides. */
export class RedisSnoozeLabelMapStore implements SnoozeLabelMapStore {
  constructor(private readonly redis: SnoozeLabelMapRedis) {}

  async get(mailboxAccountId: string): Promise<string | null> {
    return this.redis.get(snoozeLaterLabelKey(mailboxAccountId));
  }

  async set(mailboxAccountId: string, labelId: string): Promise<void> {
    await this.redis.set(
      snoozeLaterLabelKey(mailboxAccountId),
      labelId,
      'EX',
      SNOOZE_LATER_LABEL_TTL_SECONDS,
    );
  }
}
