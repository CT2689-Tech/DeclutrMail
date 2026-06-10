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
 * Queue + job name for the incremental sync (Gmail Pub/Sub-triggered;
 * D8 + D229). Each verified webhook enqueues one job over the historyId
 * range `[startHistoryId, endHistoryId]`; the worker pages
 * `users.history.list` from that cursor and reconciles
 * mail_messages + senders + sender_policies for the delta.
 */
export const INCREMENTAL_SYNC_QUEUE = 'incremental-sync';
export const INCREMENTAL_SYNC_JOB = 'incremental-sync';

/** Payload of an incremental-sync job. */
export interface IncrementalSyncJobData {
  /** Mailbox whose Gmail change triggered the webhook. */
  mailboxAccountId: string;
  /**
   * Lower bound of the historyId range to fetch — the previous
   * monotonic cursor `provider_sync_state.last_history_id`. Passed as
   * a string because Gmail historyIds are 64-bit ints; the wire is
   * decimal, no scientific notation.
   */
  startHistoryId: string;
  /**
   * Upper bound — the historyId carried by the webhook payload. The
   * Gmail history API is open-ended (paginates until current), so this
   * is informational + logged for trace; the worker stops when the
   * page set is exhausted, not when it reaches `endHistoryId`.
   */
  endHistoryId: string;
}

/**
 * Job options for an incremental-sync enqueue.
 *
 * `jobId = ${mailboxAccountId}__${endHistoryId}` namespaces by mailbox
 * AND historyId — concurrent webhooks for the same mailbox advance the
 * cursor monotonically, but a redelivered webhook for the same
 * `endHistoryId` MUST be a no-op rather than enqueueing twice. BullMQ
 * dedups by jobId so the second `add()` is silently ignored.
 *
 * Separator is `__` (double underscore), not `:` — BullMQ ≥5.77 rejects
 * jobIds containing ':' at validateOptions (smoke 2026-06-06 caught a
 * 500 on the new POST /api/v1/sync/incremental endpoint with the old
 * `${mailbox}:${historyId}` pattern). UUID + bigint both stay
 * representable without colons; the dedup semantics are preserved.
 *
 * `perMailboxPolicy` (D203/D225) governs retries — backoff matches
 * initial-sync since both speak to the same Gmail API + rate budget.
 */
export function incrementalSyncJobOptions(
  mailboxAccountId: string,
  endHistoryId: string,
): JobsOptions {
  const policy = WORKER_POLICIES.perMailboxPolicy;
  return {
    jobId: `${mailboxAccountId}__${endHistoryId}`,
    attempts: policy.maxAttempts,
    ...(policy.backoff
      ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } }
      : {}),
    // Drop completed jobs after 24h — they are pure ack signal, no
    // value beyond the cursor advance which already lives in
    // `provider_sync_state`.
    removeOnComplete: { age: 86_400 },
    removeOnFail: false,
  };
}

/**
 * Enqueue an incremental-sync job. Idempotent — BullMQ ignores a
 * duplicate jobId, so redelivered webhooks AND concurrent producers
 * (controller path + reconciler) cannot double-enqueue the same
 * `(mailboxAccountId, endHistoryId)` pair.
 */
export async function ensureIncrementalSyncJob(
  queue: Queue<IncrementalSyncJobData>,
  data: IncrementalSyncJobData,
): Promise<'added' | 'noop'> {
  // `__` separator matches incrementalSyncJobOptions — BullMQ ≥5.77
  // rejects ':' in jobIds. Keep both call sites identical so dedup works.
  const jobId = `${data.mailboxAccountId}__${data.endHistoryId}`;
  const existing = await queue.getJob(jobId);
  if (existing) {
    return 'noop';
  }
  await queue.add(
    INCREMENTAL_SYNC_JOB,
    data,
    incrementalSyncJobOptions(data.mailboxAccountId, data.endHistoryId),
  );
  return 'added';
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
 * Idle-poll ceiling for user-facing queues — env tuning can lower the
 * re-poll below this but never raise it past 10s, so pickup stays
 * snappy even on a fat-fingered env value.
 */
const USER_FACING_DRAIN_DELAY_MAX_SEC = 10;

/** Parse a positive number from env; fall back on unset/garbage. */
function envNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Env-tunable polling opts shared by every BullMQ `Worker` (2026-06-10
 * Upstash command-volume audit). An idle Worker burns 2 Redis commands
 * per `drainDelay` — at bullmq's 5s default the 7 always-on workers
 * cost ~242K idle commands/day, ~91% of the Upstash bill.
 *
 * Job pickup latency is NOT drainDelay-bound: `Queue.add` writes the
 * `{queue}:marker` zset, which immediately unblocks the worker's
 * blocking pop — `drainDelay` is only the idle re-poll safety net.
 * `stalledInterval` only affects crash-recovery latency (re-queue of a
 * job whose worker died mid-run), never healthy-path latency.
 *
 * Two profiles:
 *   - `user-facing` (initial-sync, incremental-sync, score,
 *     label-action): drainDelay clamped ≤10s; stalled check kept tight.
 *   - `cron` (brief-snapshot, undo-expiry, senders-counter-
 *     reconciliation): scheduler-driven, slow polling costs nothing.
 *
 * `drainDelay` is in SECONDS (bullmq's unit); `stalledInterval` in ms.
 */
export function workerTuningOptions(
  profile: 'user-facing' | 'cron',
  env: NodeJS.ProcessEnv = process.env,
): { drainDelay: number; stalledInterval: number } {
  if (profile === 'cron') {
    return {
      drainDelay: envNumber(env.WORKER_CRON_DRAIN_DELAY_SEC, 60),
      stalledInterval: envNumber(env.WORKER_CRON_STALLED_INTERVAL_MS, 300_000),
    };
  }
  return {
    drainDelay: Math.min(
      envNumber(env.WORKER_DRAIN_DELAY_SEC, USER_FACING_DRAIN_DELAY_MAX_SEC),
      USER_FACING_DRAIN_DELAY_MAX_SEC,
    ),
    stalledInterval: envNumber(env.WORKER_STALLED_INTERVAL_MS, 60_000),
  };
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
