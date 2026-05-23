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
 *   - `waiting` / `active` /
 *     `delayed` / `prioritized` /
 *     `waiting-children` ........... live job — no-op (`'noop'`); do
 *                                    NOT double-enqueue.
 *
 * Idempotent — safe to call from the connect path AND a periodic
 * reconciler concurrently. The reconciler's job is to add jobs the
 * connect path failed to enqueue (e.g. Redis was down at connect time)
 * AND to recover from Redis evictions.
 */
export async function ensureInitialSyncJob(
  queue: Queue<InitialSyncJobData>,
  mailboxAccountId: string,
): Promise<'added' | 'replaced' | 'noop'> {
  const existing = await queue.getJob(mailboxAccountId);
  if (existing) {
    const state = await existing.getState();
    // `unknown` indicates the job's hash has been evicted (Redis flush,
    // TTL expiry, cluster failover) — `getJob` returned a thin handle
    // but BullMQ can no longer schedule it. Treating it as live would
    // permanently strand a `queued` durable intent (Codex iter 6).
    if (state === 'completed' || state === 'failed' || state === 'unknown') {
      // `remove()` is a no-op when there's no hash to remove; safe to
      // call before adding the replacement.
      await existing.remove();
      await queue.add(
        INITIAL_SYNC_JOB,
        { mailboxAccountId },
        initialSyncJobOptions(mailboxAccountId),
      );
      return 'replaced';
    }
    // waiting / active / delayed / prioritized / waiting-children — live.
    return 'noop';
  }
  await queue.add(
    INITIAL_SYNC_JOB,
    { mailboxAccountId },
    initialSyncJobOptions(mailboxAccountId),
  );
  return 'added';
}
