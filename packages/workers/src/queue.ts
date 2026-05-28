import type { JobsOptions, Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { WORKER_POLICIES } from './worker-policies.js';

/**
 * BullMQ queue contract (D157) shared by the producer (`apps/api`
 * `SyncModule` enqueues on OAuth connect) and the consumer (the worker
 * process). Both import the name, the job-data shape, and the connection
 * factory from here so they cannot drift.
 */

/** Queue + job name for the initial full-mailbox backfill. */
export const INITIAL_SYNC_QUEUE = 'initial-sync';
export const INITIAL_SYNC_JOB = 'initial-sync';

/** Payload of an initial-sync job. */
export interface InitialSyncJobData {
  /** The mailbox to backfill. Also used as the BullMQ `jobId`. */
  mailboxAccountId: string;
}

/**
 * A Redis connection configured for BullMQ. `maxRetriesPerRequest: null`
 * is mandatory for BullMQ workers; `rediss://` URLs (Upstash) enable TLS
 * automatically. The caller owns the connection's lifecycle.
 */
export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

/**
 * Job options for an initial-sync enqueue.
 *
 * `jobId = mailboxAccountId` is the `perMailboxPolicy` idempotency key:
 * BullMQ ignores an add whose `jobId` already exists, so a duplicate
 * connect cannot start a second concurrent backfill for the same
 * mailbox. `attempts`/`backoff` come from `perMailboxPolicy` (D203/D225).
 */
export function initialSyncJobOptions(mailboxAccountId: string): JobsOptions {
  const policy = WORKER_POLICIES.perMailboxPolicy;
  return {
    jobId: mailboxAccountId,
    attempts: policy.maxAttempts,
    ...(policy.backoff
      ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } }
      : {}),
    // Keep a completed job 24h so a reconnect after that re-syncs.
    removeOnComplete: { age: 86_400 },
    removeOnFail: false,
  };
}

/**
 * Schedule (or reschedule) the initial-sync job for one mailbox (Codex
 * adversarial review iter 5 + 6, 2026-05-22).
 *
 * ONE scheduling implementation, shared by every producer (the
 * connect/reconnect path, and the worker's continuous reconciler). The
 * durable sync intent lives in `provider_sync_state.readiness_status =
 * 'queued'`; BullMQ is the execution cache. This helper keeps the cache
 * consistent with the durable intent without ever double-enqueueing.
 *
 * State table for an existing job at `jobId = mailboxAccountId`:
 *   - none ........................ add a fresh job (`'added'`)
 *   - `completed` / `failed` /
 *     `unknown` ..................... non-live — remove + re-add
 *                                    (`'replaced'`). `unknown` covers
 *                                    Redis hash eviction (TTL, flushdb,
 *                                    cluster failover) — without
 *                                    treating it as replaceable a
 *                                    `queued` durable intent could
 *                                    never materialize (Codex iter 6).
 *   - `waiting` / `delayed` /
 *     `prioritized` /
 *     `waiting-children` ........... live, NOT active — `'noop'` by
 *                                    default; with `force`, reaped +
 *                                    re-added (`'replaced'`) since its
 *                                    token is now stale.
 *   - `active` ..................... worker-locked — always `'noop'`
 *                                    (even with `force`); cannot be
 *                                    safely removed.
 *
 * Idempotent — safe to call from the connect path AND a periodic
 * reconciler concurrently. The reconciler's job is to add jobs the
 * connect path failed to enqueue (e.g. Redis was down at connect time)
 * AND to recover from Redis evictions.
 *
 * `force` (set by the (re)connect path, which has just stored a FRESH
 * OAuth token) additionally reaps a PENDING-but-not-active job so a
 * stale-token attempt — e.g. a leftover queued/delayed job from before a
 * disconnect — can't run, fail on the old token, and spuriously flip
 * readiness to `failed` (logs 2026-05-28). An `active` job is locked by
 * a worker and cannot be safely removed, so `force` never touches it —
 * it will finish/fail and the durable intent + gate recover.
 */
export async function ensureInitialSyncJob(
  queue: Queue<InitialSyncJobData>,
  mailboxAccountId: string,
  opts: { force?: boolean } = {},
): Promise<'added' | 'replaced' | 'noop'> {
  const existing = await queue.getJob(mailboxAccountId);
  if (existing) {
    const state = await existing.getState();
    // `unknown` indicates the job's hash has been evicted (Redis flush,
    // TTL expiry, cluster failover) — `getJob` returned a thin handle
    // but BullMQ can no longer schedule it. Treating it as live would
    // permanently strand a `queued` durable intent (Codex iter 6).
    const nonLive = state === 'completed' || state === 'failed' || state === 'unknown';
    // With `force`, also reap a live-but-not-active pending job (waiting/
    // delayed/prioritized/waiting-children) — its token is now stale.
    const forceReap = opts.force === true && state !== 'active';
    if (nonLive || forceReap) {
      // `remove()` is a no-op when there's no hash to remove (evicted),
      // but it REJECTS if a worker locked the job between `getState()`
      // and here (a `waiting` job picked up into `active`). Treat that
      // lost race as a no-op: the now-active attempt runs/fails and the
      // durable `queued` intent + reconciler recover — don't surface it
      // as an enqueue failure or double-add under a half-removed hash.
      try {
        await existing.remove();
      } catch {
        return 'noop';
      }
      await queue.add(
        INITIAL_SYNC_JOB,
        { mailboxAccountId },
        initialSyncJobOptions(mailboxAccountId),
      );
      return 'replaced';
    }
    // active (locked) — or any other live state without `force` — leave it.
    return 'noop';
  }
  await queue.add(INITIAL_SYNC_JOB, { mailboxAccountId }, initialSyncJobOptions(mailboxAccountId));
  return 'added';
}
