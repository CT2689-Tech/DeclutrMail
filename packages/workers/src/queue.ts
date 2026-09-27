import { randomUUID } from 'node:crypto';

import { Job, type JobsOptions, type Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { backoffJobOptions } from './rate-limit-backoff.js';
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
 * ONE QUEUED + ONE RUNNING PER MAILBOX (2026-09-25 incident). A bulk
 * Delete of 8,799 messages produced a Pub/Sub push per Gmail label
 * change. Keyed on `${mailbox}__${endHistoryId}`, every push became its
 * own job for the same mailbox; eight of them spent five attempts each
 * waiting 45s on the mailbox lock, re-reading the whole burst from Gmail
 * on every attempt, and dead-lettered.
 *
 * `deduplication` keys on the MAILBOX, with BullMQ's `keepLastIfActive`:
 *   - a waiting/delayed job exists → the push is absorbed. That job has
 *     not read history yet, and it reads from the stored cursor to
 *     Gmail's current head, so it covers the push.
 *   - the job is RUNNING → it may already have read past this push's
 *     change, so BullMQ stores the push and enqueues exactly one
 *     follow-up when the running job finishes (completes, or fails for
 *     good). Later pushes overwrite the stored one; only the latest runs.
 * Both branches execute inside BullMQ's add/finish Lua, so two API
 * instances racing the same mailbox cannot both enqueue.
 *
 * The dedup key carries the coalescing, so `jobId` is only a readable
 * prefix — mailbox and historyId, for log search — that `addCoalescedJob`
 * makes unique per add. The separator is `__` because BullMQ rejects ':'
 * in custom ids (smoke 2026-06-06).
 *
 * `perMailboxPolicy` (D203/D225) governs retries — backoff matches
 * initial-sync since both speak to the same Gmail API + rate budget.
 */
export function incrementalSyncJobOptions(
  mailboxAccountId: string,
  endHistoryId: string,
): CoalescedJobOptions {
  const policy = WORKER_POLICIES.perMailboxPolicy;
  return {
    jobId: `${mailboxAccountId}__${endHistoryId}`,
    deduplication: { id: mailboxAccountId, keepLastIfActive: true },
    attempts: policy.maxAttempts,
    ...backoffJobOptions(policy.backoff),
    // Drop completed jobs after 24h — they are pure ack signal, no
    // value beyond the cursor advance which already lives in
    // `provider_sync_state`.
    removeOnComplete: { age: 86_400 },
    removeOnFail: false,
  };
}

/**
 * How long a job may stay ACTIVE before `addCoalescedJob` stops absorbing
 * adds into it. Far past any healthy run — after the 2026-09-25 fix the
 * incident's 8,692-record burst applied in ~1.6s of lock, and even the
 * pre-fix run took 9.2 minutes end to end — so reaching it means the job is
 * stuck, not slow.
 */
export const COALESCED_STUCK_ACTIVE_MS = 30 * 60_000;

/** Options for a job coalesced per `deduplication.id` (see `addCoalescedJob`). */
export type CoalescedJobOptions = JobsOptions & {
  /** A readable prefix; `addCoalescedJob` appends a UUID per add. */
  jobId: string;
  deduplication: { id: string; keepLastIfActive: true };
};

/**
 * Add a job COALESCED on `opts.deduplication.id` — at most one queued and
 * one running job per id, via BullMQ's `keepLastIfActive` (semantics in
 * `incrementalSyncJobOptions`). For per-mailbox work whose run covers
 * every trigger that came before it, so a second queued run is pure
 * contention for the mailbox lock.
 *
 *   - `'added'` — a new job was created.
 *   - `'noop'`  — absorbed by the id's live job: a waiting/delayed one
 *     that has not started, or a running one that BullMQ will follow with
 *     one more run. Either way a run that starts AFTER this call is
 *     guaranteed; nothing is dropped.
 *
 * A finished job never swallows a later add: BullMQ clears the dedup key
 * when the job it names completes or fails for good, so a dead-lettered
 * job cannot brick its id.
 *
 * STALE KEY. With `keepLastIfActive` the dedup key has no TTL. A key that
 * outlived its job (hash evicted, a replica that lost the write) would
 * absorb every later add into a ghost: the work would stop happening and
 * nothing would fail. So when the absorbing job is gone or finished, the
 * key is cleared — compare-and-delete, only if it still names that job —
 * and the add is retried once.
 *
 * STUCK HOLDER. A job that never settles stays `active` — BullMQ renews
 * its lock while the process lives, `perMailboxPolicy` sets no deadline,
 * and a deadline could not interrupt a stalled DB or lock-pool wait anyway
 * — and an active job absorbs every add. Once it has run longer than
 * `COALESCED_STUCK_ACTIVE_MS`, it is treated like a gone one: the key is
 * cleared and a fresh job starts beside it, which is what every trigger
 * did before coalescing. Losing coalescing is the cost; silently losing
 * every sync (and every drift-sweep retry) for the mailbox is the
 * alternative. Both paths log.
 *
 * THE ID IS MADE UNIQUE HERE, per add ATTEMPT, not trusted to the caller.
 * A created job is told apart from an absorbed one by the id BullMQ hands
 * back, and BullMQ answers an add whose custom id already exists with that
 * same id BEFORE it looks at the dedup key — so a repeated id would read as
 * `'added'` while nothing was created (an Autopilot sweep id is only unique
 * to the millisecond). The retry needs its own id too: an add absorbed by a
 * RUNNING job leaves a follow-up stored under that add's id, which BullMQ
 * enqueues when the next job for the dedup id finishes — reusing the id
 * made that follow-up collide with the retry's finished job, and one push
 * ran twice under a single id (caught by the stuck-holder test).
 */
export async function addCoalescedJob<T>(
  queue: Queue<T>,
  name: Parameters<Queue<T>['add']>[0],
  data: Parameters<Queue<T>['add']>[1],
  opts: CoalescedJobOptions,
): Promise<'added' | 'noop'> {
  const add = async (): Promise<{ added: boolean; holderId: string }> => {
    const jobId = `${opts.jobId}__${randomUUID()}`;
    const job = await queue.add(name, data, { ...opts, jobId });
    // No id means we cannot tell whether anything will run, and 'noop'
    // would promise that something will. BullMQ always returns one.
    if (job.id === undefined) throw new Error(`BullMQ returned no job id for ${queue.name}`);
    // When the add is absorbed, BullMQ hands back the id of the job that
    // absorbed it rather than the id we asked for.
    return { added: job.id === jobId, holderId: job.id };
  };

  const first = await add();
  if (first.added) return 'added';

  const holder = await queue.getJob(first.holderId);
  const state = holder ? await holder.getState() : 'unknown';
  const activeForMs =
    state === 'active' && holder?.processedOn !== undefined ? Date.now() - holder.processedOn : 0;
  const stuck = activeForMs > COALESCED_STUCK_ACTIVE_MS;
  if (!stuck && state !== 'completed' && state !== 'failed' && state !== 'unknown') return 'noop';

  // Finished, gone, or stuck. If it finished AFTER absorbing this add,
  // BullMQ has already moved the key on (to the follow-up it enqueued, or
  // cleared it), the delete below matches nothing, and the absorbed add is
  // safe.
  const cleared = await new Job(
    queue,
    name,
    data,
    { deduplication: { id: opts.deduplication.id } },
    first.holderId,
  ).removeDeduplicationKey();
  if (!cleared) return 'noop';

  console.warn(
    JSON.stringify({
      level: 'warn',
      kind: stuck ? 'queue.coalesced_holder_stuck' : 'queue.stale_dedup_key_cleared',
      queue: queue.name,
      dedupId: opts.deduplication.id,
      holderState: state,
      ...(stuck ? { activeForMs } : {}),
    }),
  );
  return (await add()).added ? 'added' : 'noop';
}

/**
 * Enqueue an incremental-sync job, coalesced per mailbox (see
 * `incrementalSyncJobOptions`). Shared by every producer: the Pub/Sub
 * webhook, "Sync now", and the drift sweep. Re-running an unchanged
 * cursor ("Sync now" on a quiet mailbox, the drift sweep) still produces
 * a run once the previous one has finished — the completion signal the
 * D38/D224 watch consumes.
 */
export async function ensureIncrementalSyncJob(
  queue: Queue<IncrementalSyncJobData>,
  data: IncrementalSyncJobData,
): Promise<'added' | 'noop'> {
  return addCoalescedJob(
    queue,
    INCREMENTAL_SYNC_JOB,
    data,
    incrementalSyncJobOptions(data.mailboxAccountId, data.endHistoryId),
  );
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
 * A Redis connection for a producer that ENQUEUES FROM A REQUEST PATH.
 *
 * `createRedisConnection` above is built for workers, and its defaults
 * are the opposite of what a request needs. Two of them, and BOTH have
 * to go — they cover different halves of the same outage.
 *
 * `enableOfflineQueue` covers commands issued while the connection is
 * ALREADY down: ioredis buffers them in memory and flushes them on
 * reconnect. Right for a worker, which must not drop a job because
 * Redis blinked. On a request path it is a leak with a delayed
 * detonation — every request adds another never-settling command to a
 * queue nobody is draining, so an outage grows memory for as long as
 * it lasts and recovery replays the whole backlog in one burst.
 *
 * `maxRetriesPerRequest: null` covers the other half: commands already
 * IN FLIGHT when the connection breaks. ioredis only flushes its
 * command queue when this is a number (`event_handler`: the flush is
 * guarded by `typeof maxRetriesPerRequest === 'number'`), so `null`
 * means an in-flight command is retained and retried across every
 * reconnect — and a caller that gave up waiting has not stopped it
 * from eventually being replayed. `0` flushes on the first reconnect
 * attempt (`retryAttempts % (0 + 1)` is always 0), which is what makes
 * "we stopped waiting" and "it will not happen later" the same thing.
 *
 * Together they convert silence into an immediate rejection a caller
 * can handle. The trade is explicit: an enqueue attempted during an
 * outage is LOST rather than deferred. Only use this for work that is
 * genuinely best-effort and self-healing — the icon queue qualifies,
 * because the next list read schedules the same domain again and an
 * unresolved domain renders the monogram that ADR-0034 defines as the
 * floor. Anything whose loss a user would notice belongs on
 * `createRedisConnection`.
 *
 * Safe with BullMQ: it forces `maxRetriesPerRequest: null` only for
 * BLOCKING connections, and only when it constructs the client itself
 * — a raw instance like this one is passed through untouched
 * (`redis-connection.js`).
 */
export function createRedisProducerConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: 0, enableOfflineQueue: false });
}

/**
 * Idle-poll ceiling for user-facing queues — env tuning can lower the
 * re-poll below this but never raise it past this many seconds, so a
 * fat-fingered env can't strand pickup. Set to 60s: job pickup is
 * marker-driven (see `workerTuningOptions`), NOT drainDelay-bound, so a
 * longer idle re-poll costs Redis commands but not latency — the ceiling
 * only guards the pathological "marker missed" fallback path, which 60s
 * still covers acceptably. Raised from 10s in the 2026-07-15 Upstash
 * cost cut (prod Redis budget-suspended by idle polling from 17 workers).
 */
const USER_FACING_DRAIN_DELAY_MAX_SEC = 60;

/** Parse a positive number from env; fall back on unset/garbage. */
function envNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Env-tunable polling opts shared by every BullMQ `Worker` (2026-06-10
 * Upstash command-volume audit; retuned 2026-07-15 after a prod Redis
 * budget-suspension). An idle Worker burns ~2 Redis commands per
 * `drainDelay`. The composition root runs 17 always-on Workers (not the
 * 7 this comment first assumed) — at a 10s user-facing drainDelay that
 * is the dominant Upstash cost, and it suspended the pre-launch $20
 * budget with zero real traffic.
 *
 * Job pickup latency is NOT drainDelay-bound: `Queue.add` writes the
 * `{queue}:marker` zset, which immediately unblocks the worker's
 * blocking pop — `drainDelay` is only the idle re-poll safety net.
 * `stalledInterval` only affects crash-recovery latency (re-queue of a
 * job whose worker died mid-run), never healthy-path latency. So the
 * pre-launch prod env sets a slow re-poll (60s user-facing / 300s cron)
 * for a ~6× idle-command cut at no felt latency — see the DEV-PHASE
 * override in deploy-cloud-run.yml (revert toward the D193 tighter
 * values when real traffic warrants snappier crash recovery).
 *
 * Two profiles:
 *   - `user-facing` (initial-sync, incremental-sync, score,
 *     label-action): drainDelay clamped ≤60s; stalled check env-tuned.
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
    ...backoffJobOptions(policy.backoff),
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
