import type { JobsOptions, Queue } from 'bullmq';

import { WORKER_POLICIES } from './worker-policies.js';
import type { BriefSnapshotJobData } from './brief-snapshot.worker.js';

/**
 * BullMQ contract for the Brief snapshot cron (D61, D62, D63, D67, D69).
 *
 * Shared between the producer (the scheduler in the worker composition
 * root) and the consumer (`BriefSnapshotWorker`). Co-locating queue
 * name + idempotency-key encoding here keeps producer/consumer from
 * drifting.
 */

export const BRIEF_SNAPSHOT_QUEUE = 'brief-snapshot';
export const BRIEF_SNAPSHOT_JOB = 'brief-snapshot';

/**
 * Period between Brief snapshots — 1 hour.
 *
 * D64 specifies "8am in user's local timezone", which means the cron
 * has to fire often enough that every UTC offset's 8am gets a fair
 * shake. Hourly ticks let the worker pick up "it's 8am for THIS
 * mailbox now" within at most 60 minutes of the user's local 8am.
 *
 * The actual per-mailbox dedup is the D69 UNIQUE on `(mailbox_account_id,
 * run_date_local)` — the worker upserts ON CONFLICT DO NOTHING, so a
 * second tick within the same local-date for the same mailbox is a
 * no-op. The 1-hour cadence is a safety net, not a write amplifier.
 *
 * V2 simplification: every user is assumed UTC. The actual TZ-aware
 * routing lands when `users.timezone` ships — a focused follow-up.
 */
export const BRIEF_SNAPSHOT_INTERVAL_MS = 60 * 60 * 1_000;

/**
 * Round a Date down to its minute boundary (`YYYY-MM-DDTHH:MM`). The
 * D225 cron idempotency key — paired with the worker name it dedupes
 * concurrent enqueues for the same scheduling minute.
 */
export function scheduledAtMinute(now: Date = new Date()): string {
  const iso = now.toISOString();
  return iso.slice(0, 16);
}

export function briefSnapshotJobOptions(scheduledAtMinuteValue: string): JobsOptions {
  const policy = WORKER_POLICIES.cronPolicy;
  return {
    jobId: `BriefSnapshotWorker:${scheduledAtMinuteValue}`,
    attempts: policy.maxAttempts,
    ...(policy.backoff
      ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } }
      : {}),
    removeOnComplete: { age: 24 * 60 * 60 },
    removeOnFail: false,
  };
}

/**
 * Enqueue one Brief snapshot tick. Idempotent on `scheduledAtMinute`
 * — safe to call from a setInterval driver without coordination.
 */
export async function enqueueBriefSnapshotTick(
  queue: Queue<BriefSnapshotJobData>,
  now: Date = new Date(),
): Promise<void> {
  const minute = scheduledAtMinute(now);
  await queue.add(
    BRIEF_SNAPSHOT_JOB,
    { scheduledAtMinute: minute },
    briefSnapshotJobOptions(minute),
  );
}
