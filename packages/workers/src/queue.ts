import type { JobsOptions } from 'bullmq';
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
