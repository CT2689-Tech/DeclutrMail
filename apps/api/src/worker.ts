import 'reflect-metadata';

import Anthropic from '@anthropic-ai/sdk';
import { Queue, Worker } from 'bullmq';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { OAuth2Client } from 'google-auth-library';
import postgres from 'postgres';
import { mailboxAccounts, providerSyncState, schema } from '@declutrmail/db';
import {
  BRIEF_SNAPSHOT_INTERVAL_MS,
  BRIEF_SNAPSHOT_QUEUE,
  BriefSnapshotWorker,
  createRedisConnection,
  ensureInitialSyncJob,
  enqueueBriefSnapshotTick,
  INITIAL_SYNC_QUEUE,
  InitialSyncWorker,
  InvalidGrantError,
  LABEL_ACTION_QUEUE,
  LabelActionWorker,
  OutboxPublisher,
  RateLimiter,
  SCORE_JOB,
  SCORE_QUEUE,
  ScoreWorker,
  ValidationError,
} from '@declutrmail/workers';
import type {
  BriefSnapshotJobData,
  BriefSnapshotResult,
  GmailAccess,
  GmailMutationAccess,
  InitialSyncJobData,
  InitialSyncResult,
  LabelActionJobData,
  LabelActionResult,
  MailboxActionLock,
  ScoreJobData,
  ScoreJobResult,
} from '@declutrmail/workers';

import { AnthropicHaikuAdapter } from './adapters/anthropic-haiku.adapter.js';
import { buildBriefLlmAdapter } from './adapters/brief-llm-anthropic.adapter.js';
import { createKmsProvider } from './adapters/gcp-kms/kms-provider.factory.js';
import { TokenCryptoService } from './auth/token-crypto.service.js';
import { GmailClientService } from './gmail/gmail-client.service.js';
import { initSentry } from './observability/sentry.js';
import { createSentryWorkerObserver } from './observability/sentry-worker-observer.js';

/**
 * Worker process composition root (D157).
 *
 * The BullMQ consumer runs as its OWN process — separate from the HTTP
 * API (`main.ts`). It wires the concrete `apps/api` adapters
 * (`TokenCryptoService`, `GmailClientService`) into the framework-
 * agnostic `InitialSyncWorker` from `@declutrmail/workers`. Dependency
 * direction stays `apps/api → packages/workers`.
 *
 * Local dev: `./scripts/dev-worker.sh`.
 */

/**
 * Gmail quota throttle (D5). Gmail meters 15,000 quota units / user /
 * minute; we pace to 12,000 (20% headroom) — `messages.get` is 5 units,
 * so ~2,400 messages/min. One limiter per mailbox (the quota is
 * per-user).
 */
const GMAIL_QUOTA_UNITS_PER_MIN = 12_000;
const GMAIL_QUOTA_WINDOW_MS = 60_000;

/** Read a required env var or fail loudly at boot. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — see .env.example.`);
  }
  return value;
}

async function bootstrap(): Promise<void> {
  // D159: initialise Sentry before anything else so the worker process —
  // including the boot-time reconciler sweep — has the SDK installed for
  // any uncaught error path. No-op without `SENTRY_DSN` (mirrors the API
  // process; local dev + tests are unaffected).
  await initSentry();
  const observer = await createSentryWorkerObserver({ dsnSet: Boolean(process.env.SENTRY_DSN) });

  const pg = postgres(requireEnv('DATABASE_URL'));
  const db = drizzle(pg, { schema });

  /**
   * Concurrency cap for the destructive label-action worker. Modest by
   * design — destructive mutations are not a throughput path, and each
   * job holds a per-mailbox advisory lock (below) for its full duration.
   */
  const LABEL_ACTION_CONCURRENCY = 10;
  /**
   * DEDICATED connection pool for the per-mailbox advisory lock, sized to
   * the label-action concurrency. This is the deadlock fix: the lock
   * holder pins a connection for the whole resolve→mutate→commit (incl.
   * the multi-second Gmail call), while the inner DB work draws from the
   * MAIN pool (`pg`). If the lock reserved from `pg`, a job holding a
   * reserved connection AND needing a second pool connection for its
   * queries would deadlock once ≥`pg.max` jobs ran (N holders each
   * needing the N+1th). Separate pools = no hold-and-wait, regardless of
   * any concurrency number.
   */
  const lockPg = postgres(requireEnv('DATABASE_URL'), { max: LABEL_ACTION_CONCURRENCY });
  /** Advisory-lock namespace (first key) — isolates label-action locks. */
  const LABEL_ACTION_LOCK_NS = 0x4c41; // 'LA'
  const tokenCrypto = new TokenCryptoService(createKmsProvider());
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');

  /**
   * Per-mailbox `RateLimiter`s, cached by `mailboxAccountId` for the
   * lifetime of the worker process (Codex adversarial review iter 3,
   * 2026-05-22). Earlier the limiter was created fresh per
   * `getClient()` call — every BullMQ retry started with an empty
   * window, but Gmail's per-user quota bucket persists for 60s. A
   * post-quota retry within `perMailboxPolicy.backoff` (2s/4s/8s/...)
   * would re-spend a full local budget while Gmail still counted the
   * prior attempt's usage → repeated 403s and eventual dead-letter.
   *
   * Sharing the limiter across attempts lets its sliding-window state
   * persist: a retry's first `acquire(5)` sees the prior attempt's
   * spend, computes the remaining wait until the oldest event ages out
   * of the 60s window, and sleeps before sending — no thrash.
   *
   * Memory: one limiter per distinct mailbox synced by this process,
   * each holding at most `windowMs / minRequestSpacing` events
   * (~thousands). Bounded; process restart clears the cache.
   */
  const limiterByMailbox = new Map<string, RateLimiter>();

  /**
   * `GmailAccess` port impl: load the mailbox row, decrypt its OAuth
   * refresh token (D14 envelope decryption — reuses `TokenCryptoService`
   * unchanged), and return a token-bound Gmail client.
   */
  // One token-bound client builder, shared by the read port (`GmailAccess`)
  // and the mutation port (`GmailMutationAccess`) — `GmailClientService`
  // implements both, so the SAME factory (and the same decrypt path —
  // §9 reuse-only) serves the metadata sync and the label-action worker.
  const getGmailClient = async (mailboxAccountId: string): Promise<GmailClientService> => {
    const [account] = await db
      .select()
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.id, mailboxAccountId))
      .limit(1);
    if (!account) {
      throw new ValidationError(`mailbox account ${mailboxAccountId} not found`);
    }
    if (!account.encryptedRefreshToken || !account.dekEncrypted) {
      throw new InvalidGrantError(`mailbox account ${mailboxAccountId} has no stored OAuth token`);
    }
    const refreshToken = await tokenCrypto.decrypt(
      account.encryptedRefreshToken,
      account.dekEncrypted,
    );
    const oauth = new OAuth2Client(clientId, clientSecret);
    oauth.setCredentials({ refresh_token: refreshToken });

    // Reuse the limiter across attempts so its sliding-window state
    // outlives a single `processJob` call (D5 / Codex iter 3).
    let limiter = limiterByMailbox.get(mailboxAccountId);
    if (!limiter) {
      limiter = new RateLimiter(GMAIL_QUOTA_UNITS_PER_MIN, GMAIL_QUOTA_WINDOW_MS);
      limiterByMailbox.set(mailboxAccountId, limiter);
    }
    return new GmailClientService(oauth, limiter);
  };
  const gmailAccess: GmailAccess = { getClient: getGmailClient };
  const gmailMutationAccess: GmailMutationAccess = { getClient: getGmailClient };

  /**
   * Per-mailbox advisory lock for destructive actions (D226, Codex
   * review). `perMailboxPolicy` does NOT actually serialize per mailbox
   * (BullMQ runs `concurrency` jobs across mailboxes), and destructive
   * mutations are the wrong place to bet on benign races. A connection
   * reserved from the DEDICATED `lockPg` pool holds the advisory lock for
   * the whole resolve→mutate→commit; the lock is a keyed mutex, so the
   * inner work runs on the MAIN pool. Released in `finally`; on connection
   * loss Postgres drops the session lock automatically.
   *
   * Two-key form `pg_advisory_lock(ns, hashtext(mailbox))` isolates these
   * locks under a label-action namespace. `hashtext` is 32-bit, so two
   * distinct mailboxes can collide and over-serialize — harmless (extra
   * mutual exclusion, never incorrect), and rare.
   */
  const mailboxLock: MailboxActionLock = {
    async run(mailboxAccountId, fn) {
      const reserved = await lockPg.reserve();
      try {
        await reserved`SELECT pg_advisory_lock(${LABEL_ACTION_LOCK_NS}, hashtext(${mailboxAccountId}))`;
        return await fn();
      } finally {
        try {
          await reserved`SELECT pg_advisory_unlock(${LABEL_ACTION_LOCK_NS}, hashtext(${mailboxAccountId}))`;
        } catch {
          // Best-effort unlock; the session ending releases it regardless.
        }
        reserved.release();
      }
    },
  };

  const connection = createRedisConnection(requireEnv('REDIS_URL'));

  // Score-queue PRODUCER (D25 sync_complete trigger). The initial sync
  // enqueues one all-senders score sweep here once the sender index is
  // built, so `triage_decisions` populate after a fresh sync. The
  // CONSUMER (`scoreBullWorker`) is wired further down in this same
  // process. `jobId = mailbox:*:producedAt` matches ScoreWorker's
  // idempotency key for the all-senders sweep.
  const scoreProducerQueue = new Queue<ScoreJobData>(SCORE_QUEUE, { connection });

  const initialSync = new InitialSyncWorker({
    db,
    gmailAccess,
    onSenderIndexBuilt: async (mailboxAccountId) => {
      const producedAtMs = Date.now();
      await scoreProducerQueue.add(
        SCORE_JOB,
        { mailboxAccountId, trigger: 'sync_complete', producedAtMs },
        { jobId: `${mailboxAccountId}:*:${producedAtMs}` },
      );
    },
  });
  // D159: install the Sentry seam on every BaseDeclutrWorker BEFORE the
  // BullMQ `Worker` starts pulling jobs, so the very first terminal
  // failure routes through the observer (no warm-up window).
  initialSync.setObserver(observer);

  const bullWorker = new Worker<InitialSyncJobData, InitialSyncResult>(
    INITIAL_SYNC_QUEUE,
    (job) => initialSync.run(job),
    // concurrency = D203 global queue cap; per-mailbox=1 is enforced by
    // the `jobId = mailboxAccountId` dedup in `initialSyncJobOptions`.
    { connection, concurrency: 20 },
  );

  bullWorker.on('error', (err) => {
    console.error(JSON.stringify({ level: 'error', kind: 'bullmq.error', message: err.message }));
  });

  /**
   * BriefSnapshotWorker consumer + scheduler (D61, D62, D63, D67, D69,
   * D70). The worker is a `cronPolicy` (D203/D225) — its jobs are
   * produced by a setInterval driver inside this composition root, not
   * by user actions or external events. Wiring is split into two parts:
   *
   *   1. The BullMQ consumer that runs one snapshot pass per tick.
   *   2. The setInterval scheduler that calls `enqueueBriefSnapshotTick`
   *      every `BRIEF_SNAPSHOT_INTERVAL_MS` (1 hour). The queue's
   *      `jobId = BriefSnapshotWorker:${scheduledAtMinute}` is the D225
   *      idempotency key — repeated enqueues for the same minute are
   *      no-ops, so the scheduler is safe to fire on any cadence.
   *
   * D62 LLM wiring: `buildBriefLlmAdapter()` returns the Anthropic Haiku
   * adapter when `ANTHROPIC_API_KEY` is set, `null` otherwise. The
   * worker accepts `undefined` to mean "no LLM available; always use
   * the deterministic template". `null → undefined` so the worker
   * checks `this.deps.llm` rather than `null !== undefined`.
   */
  const briefLlm = buildBriefLlmAdapter();
  const briefSnapshotWorker = new BriefSnapshotWorker(briefLlm ? { db, llm: briefLlm } : { db });
  briefSnapshotWorker.setObserver(observer);

  const briefSnapshotBullWorker = new Worker<BriefSnapshotJobData, BriefSnapshotResult>(
    BRIEF_SNAPSHOT_QUEUE,
    (job) => briefSnapshotWorker.run(job),
    // cronPolicy is global-scope; the worker's internal per-mailbox
    // fan-out (`BRIEF_SNAPSHOT_CONCURRENCY`) handles parallelism within
    // a single job. Outer concurrency=1 keeps ticks from overlapping
    // — D69's per-mailbox UNIQUE makes overlap safe, but skipping
    // duplicate work is cheaper.
    { connection, concurrency: 1 },
  );

  briefSnapshotBullWorker.on('error', (err) => {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'bullmq.error',
        queue: BRIEF_SNAPSHOT_QUEUE,
        message: err.message,
      }),
    );
  });

  /**
   * ScoreWorker consumer (D21, D25, D203). Runs the cascade + scoring
   * engine for one (mailbox, sender) — or every active sender in the
   * mailbox when the job payload omits `senderKey`. Producer side lives
   * in `TriageModule.SCORE_QUEUE_TOKEN` (POST `/api/triage/score-sender`)
   * and — once D25's trigger-based wiring lands — in the initial-sync
   * worker's terminal "ready" stage.
   *
   * D24 reasoning: `AnthropicHaikuAdapter` is wired when `ANTHROPIC_API_KEY`
   * is set; absent the key the worker runs template-only (still produces
   * verdicts, just without LLM-generated reasoning). The adapter never
   * throws — it returns `null` on any failure per the `ReasoningLlmPort`
   * contract, which the worker treats as "use the template".
   *
   * Policy `perMailboxPolicy` (D203/D225). BullMQ `jobId` dedup is
   * exact-string match: the producer's
   * `${mailboxAccountId}:${senderKey}:${producedAtMs}` key changes per
   * trigger event, so distinct trigger events for the same (mailbox,
   * sender) produce different jobs that this consumer CAN run in
   * parallel under the global `concurrency: 20` cap. True per-mailbox
   * concurrency=1 is not enforced at the consumer here; instead
   * `ScoreWorker`'s upsert is monotonic (`ON CONFLICT DO UPDATE …
   * WHERE existing.produced_at < new.produced_at`), so an older job
   * that finishes after a newer one is a no-op at the DB layer.
   * That keeps `triage_decisions` race-correct without sacrificing
   * cross-mailbox throughput — distinct mailboxes still run in
   * parallel under the outer cap.
   */
  const reasoningLlm = process.env.ANTHROPIC_API_KEY
    ? new AnthropicHaikuAdapter({
        client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
      })
    : undefined;
  const scoreWorker = new ScoreWorker(reasoningLlm ? { db, llm: reasoningLlm } : { db });
  scoreWorker.setObserver(observer);

  const scoreBullWorker = new Worker<ScoreJobData, ScoreJobResult>(
    SCORE_QUEUE,
    (job) => scoreWorker.run(job),
    { connection, concurrency: 20 },
  );

  scoreBullWorker.on('error', (err) => {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'bullmq.error',
        queue: SCORE_QUEUE,
        message: err.message,
      }),
    );
  });

  /**
   * LabelActionWorker consumer (D226). The action-consumer for the async
   * destructive-action pipeline — applies a label-modify verb (archive
   * now) forward + reverse (undo), then issues the undo token + activity
   * row + outbox event in one terminal tx. Producer side lives in
   * `ActionsModule` (POST /api/actions/archive) and `UndoController`
   * (POST /api/undo/:token enqueues the reverse). Policy `perMailboxPolicy`
   * + the per-mailbox advisory lock serialize destructive mutations.
   */
  const labelActionWorker = new LabelActionWorker({
    db,
    gmailMutation: gmailMutationAccess,
    outbox: new OutboxPublisher(),
    lock: mailboxLock,
  });
  labelActionWorker.setObserver(observer);

  const labelActionBullWorker = new Worker<LabelActionJobData, LabelActionResult>(
    LABEL_ACTION_QUEUE,
    (job) => labelActionWorker.run(job),
    // Bounded to the dedicated `lockPg` pool size — every job holds one
    // advisory-lock connection for its full duration.
    { connection, concurrency: LABEL_ACTION_CONCURRENCY },
  );

  labelActionBullWorker.on('error', (err) => {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'bullmq.error',
        queue: LABEL_ACTION_QUEUE,
        message: err.message,
      }),
    );
  });

  // Continuous reconciler (Codex adversarial review iter 5 + 6,
  // 2026-05-22).
  //
  // Contract: `provider_sync_state.readiness_status='queued'` IS the
  // durable sync intent. BullMQ is the execution cache. The connect
  // path writes the DB row first, then best-effort enqueues — if Redis
  // was down at connect time the DB has a `queued` row with no live
  // BullMQ job. We sweep periodically and materialize the missing job.
  //
  // Boot-only reconciliation (iter 4) was insufficient: a Redis outage
  // that happens AFTER worker boot — Redis crashes, network blip — was
  // never recovered from without a worker restart. Now we tick every
  // 60s. The job is bounded (one BullMQ `getJob` + at most one `add`
  // per `queued` row, batch-capped) and self-throttling: once the DB
  // has no `queued` rows the sweep is a single `SELECT ... LIMIT N`.
  const reconcilerQueue = new Queue<InitialSyncJobData>(INITIAL_SYNC_QUEUE, { connection });
  const RECONCILE_BATCH = 100;
  const RECONCILE_INTERVAL_MS = 60_000;

  // Overlap + shutdown guards (Codex iter 6). A slow sweep (e.g.
  // Redis-paginated `getJob`s under load) could exceed the interval
  // and overlap with the next firing — without a guard, two
  // concurrent sweeps could race a `remove`+`add` pair against each
  // other for the same job. `inFlight` tracks the active tick (a
  // Promise we can `await` on shutdown); `shuttingDown` short-circuits
  // any tick that fires after the shutdown signal but before
  // `clearInterval` runs.
  let inFlight: Promise<void> | null = null;
  let shuttingDown = false;

  /**
   * One reconciliation tick. Reads up to `RECONCILE_BATCH` rows whose
   * `readiness_status='queued'` and ensures each has a live BullMQ job.
   * Delegates the per-mailbox state machine to `ensureInitialSyncJob`
   * — the single scheduling implementation shared with the connect
   * path — so this loop cannot diverge from connect-time semantics.
   *
   * Returns counts for the structured log; never throws (it's a
   * background sweep, not a request).
   */
  async function reconcileQueuedInitialSyncs(): Promise<{ added: number; replaced: number }> {
    let added = 0;
    let replaced = 0;
    try {
      const queuedRows = await db
        .select({ mailboxAccountId: providerSyncState.mailboxAccountId })
        .from(providerSyncState)
        .where(eq(providerSyncState.readinessStatus, 'queued'))
        .limit(RECONCILE_BATCH);
      for (const { mailboxAccountId } of queuedRows) {
        if (shuttingDown) {
          // Honor a mid-sweep shutdown signal — leftover rows pick up
          // on the next worker boot.
          break;
        }
        const outcome = await ensureInitialSyncJob(reconcilerQueue, mailboxAccountId);
        if (outcome === 'added') added += 1;
        if (outcome === 'replaced') replaced += 1;
      }
      if (added > 0 || replaced > 0) {
        console.log(
          JSON.stringify({
            level: 'info',
            kind: 'reconciler.swept',
            added,
            replaced,
            scanned: queuedRows.length,
          }),
        );
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'reconciler.failed',
          message: error.message,
        }),
      );
      // D159 — route reconciler failures through the SAME Sentry seam as
      // BaseDeclutrWorker (FOUNDER-FOLLOWUPS 2026-05-22 D-CANDIDATE). The
      // reconciler runs outside the BullMQ loop, so without this call
      // it would silently miss Sentry once the DSN is configured.
      observer.captureBackgroundFailure(error, { kind: 'reconciler.failed' });
    }
    return { added, replaced };
  }

  /**
   * Wrap one tick with the overlap guard. If a prior tick is still
   * running OR a shutdown is in progress, the firing is skipped —
   * never queued behind the in-flight one (the next 60s tick has
   * fresh data anyway).
   */
  function tick(): void {
    if (shuttingDown || inFlight) {
      return;
    }
    // `reconcileQueuedInitialSyncs` is documented to never reject (its
    // body is wrapped in try/catch). The terminal `.catch` defends
    // against future drift: if a refactor moves a line out of that try,
    // an unhandled rejection here would otherwise be invisible
    // (silent-failure-hunter, post-iter-6 review).
    const p = reconcileQueuedInitialSyncs()
      .then(() => undefined)
      .finally(() => {
        inFlight = null;
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'reconciler.tick_unexpected',
            message: error.message,
          }),
        );
        // Defense-in-depth seam: `reconcileQueuedInitialSyncs` is
        // documented never to reject, but if a future refactor moves a
        // line out of its try/catch, an unhandled rejection here would
        // otherwise be invisible. Route through the same Sentry seam
        // (D159).
        observer.captureBackgroundFailure(error, { kind: 'reconciler.tick_unexpected' });
      });
    inFlight = p;
  }

  // Boot sweep — handles any `queued` rows that accumulated while the
  // worker was offline (deploy gap, crash recovery). Tracked via the
  // same `inFlight` slot so a shutdown during boot waits for it.
  tick();
  if (inFlight) {
    await inFlight;
  }

  // Periodic sweep — handles outages that happen AFTER boot. The
  // handle is captured so shutdown can `clearInterval` cleanly.
  const reconcilerHandle = setInterval(tick, RECONCILE_INTERVAL_MS);
  // Don't keep the process alive solely on the reconciler tick; the
  // BullMQ worker is the foreground loop.
  reconcilerHandle.unref();

  /**
   * Brief snapshot cron scheduler (D62, D64, D225). Every hour, enqueue
   * a tick keyed on the current minute. `enqueueBriefSnapshotTick` is
   * idempotent — repeated enqueues for the same minute resolve to one
   * BullMQ job via the `jobId` dedup. The hourly cadence is what gives
   * each UTC offset's local 8am a fair shake (the worker decides
   * per-mailbox whether yesterday's local-date Brief already exists).
   *
   * The driver is `setInterval`-based rather than BullMQ's repeatable-
   * job feature so the scheduling rule lives in TypeScript (testable,
   * reviewable) rather than in Redis state. Re-deploys reset the
   * cadence cleanly; nothing leaks between worker generations.
   */
  const briefSchedulerQueue = new Queue<BriefSnapshotJobData>(BRIEF_SNAPSHOT_QUEUE, { connection });

  async function enqueueBriefTick(): Promise<void> {
    if (shuttingDown) return;
    try {
      await enqueueBriefSnapshotTick(briefSchedulerQueue);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'brief.scheduler_failed',
          message: error.message,
        }),
      );
      // Background seam — scheduler runs outside the BullMQ loop so the
      // BaseDeclutrWorker observer wouldn't otherwise see it (D159).
      observer.captureBackgroundFailure(error, { kind: 'brief.scheduler_failed' });
    }
  }

  // Boot enqueue + periodic enqueue. The boot tick covers the case
  // where the worker has been down across an hourly boundary — D69
  // makes a same-day re-run a no-op, so an extra boot enqueue costs
  // nothing.
  await enqueueBriefTick();
  const briefSchedulerHandle = setInterval(() => {
    void enqueueBriefTick();
  }, BRIEF_SNAPSHOT_INTERVAL_MS);
  briefSchedulerHandle.unref();

  console.log(
    JSON.stringify({ level: 'info', kind: 'worker.listening', queue: INITIAL_SYNC_QUEUE }),
  );
  console.log(
    JSON.stringify({
      level: 'info',
      kind: 'worker.listening',
      queue: BRIEF_SNAPSHOT_QUEUE,
      llmWired: Boolean(briefLlm),
    }),
  );

  // Graceful shutdown — stop the reconciler tick, AWAIT any in-flight
  // sweep, then drain BullMQ and release connections. Closing the
  // queue/connection while a sweep is mid-`getJob` would throw
  // unhandled errors and corrupt the structured log.
  //
  // The drain IIFE has its own `.catch` (silent-failure-hunter, post-
  // iter-6 review): without it, a thrown `bullWorker.close()` /
  // `connection.quit()` during a Redis outage would leave `exit(0)`
  // unreached, the process would hang on still-attached resources, and
  // K8s would SIGKILL after the grace period with no diagnostic.
  const shutdown = (signal: string): void => {
    console.log(JSON.stringify({ level: 'info', kind: 'worker.shutdown', signal }));
    shuttingDown = true;
    clearInterval(reconcilerHandle);
    clearInterval(briefSchedulerHandle);
    void (async () => {
      if (inFlight) {
        await inFlight;
      }
      await bullWorker.close();
      await briefSnapshotBullWorker.close();
      await briefSchedulerQueue.close();
      await scoreBullWorker.close();
      await labelActionBullWorker.close();
      await reconcilerQueue.close();
      await connection.quit();
      await lockPg.end();
      await pg.end();
      process.exit(0);
    })().catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'worker.shutdown_failed',
          signal,
          message: error.message,
        }),
      );
      // D159 background seam — shutdown failures also live outside the
      // BullMQ loop; capture them so a stuck drain shows up in Sentry
      // instead of only the K8s SIGKILL log.
      observer.captureBackgroundFailure(error, {
        kind: 'worker.shutdown_failed',
        tags: { signal },
      });
      // Exit non-zero so the orchestrator (K8s / Cloud Run) sees the
      // drain failed instead of hanging until SIGKILL.
      process.exit(1);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Boot-time errors (bad `DATABASE_URL`, Redis TLS failure, KMS
// failure inside `createKmsProvider()`, the initial reconciler sweep
// rejecting against an unreachable DB) would otherwise become
// `unhandledRejection`s — Node's default printing varies by
// `--unhandled-rejections` mode and would not produce a structured
// `worker.boot_failed` log line the operator can grep. Catch + log +
// non-zero exit. Silent-failure-hunter, post-iter-6 review.
//
// D159: also route boot failures to Sentry via a one-shot observer.
// `initSentry()` is idempotent — calling it again here is a safe no-op
// after a successful boot, and a critical signal if the bootstrap
// `initSentry()` itself was the failure (the second call still
// completes since the DSN is read fresh from env).
bootstrap().catch((err: unknown) => {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error(
    JSON.stringify({
      level: 'error',
      kind: 'worker.boot_failed',
      message: error.message,
    }),
  );
  void (async () => {
    try {
      await initSentry();
      const obs = await createSentryWorkerObserver({
        dsnSet: Boolean(process.env.SENTRY_DSN),
      });
      obs.captureBackgroundFailure(error, { kind: 'worker.boot_failed' });
    } catch {
      // Capturing the boot failure must never itself crash the exit
      // path — better to lose the Sentry event than hang the process.
    } finally {
      process.exit(1);
    }
  })();
});
