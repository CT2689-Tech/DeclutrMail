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
  enqueueSendersCounterReconciliationTick,
  enqueueUndoExpiryTick,
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
  SENDERS_COUNTER_RECONCILIATION_INTERVAL_MS,
  SENDERS_COUNTER_RECONCILIATION_QUEUE,
  SendersCounterReconciliationWorker,
  UNDO_EXPIRY_INTERVAL_MS,
  UNDO_EXPIRY_QUEUE,
  UndoExpiryWorker,
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
  SendersCounterReconciliationJobData,
  SendersCounterReconciliationResult,
  UndoExpiryJobData,
  UndoExpiryResult,
} from '@declutrmail/workers';

import { AnthropicHaikuAdapter } from './adapters/anthropic-haiku.adapter.js';
import { buildBriefLlmAdapter } from './adapters/brief-llm-anthropic.adapter.js';
import { createKmsProvider } from './adapters/gcp-kms/kms-provider.factory.js';
import { TokenCryptoService } from './auth/token-crypto.service.js';
import { GmailClientService } from './gmail/gmail-client.service.js';
import { initSentry } from './observability/sentry.js';
import { createSentryWorkerObserver } from './observability/sentry-worker-observer.js';
import { SecurityEventsService } from './security-events/security-events.service.js';

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

/**
 * Boot-time env audit (2026-06-08 session — closes the "worker missed
 * GOOGLE_CLIENT_SECRET silently" bug). Emits one structured
 * `worker.boot.env_check` log line at the very start of bootstrap
 * listing every required env that's missing. With this line in place,
 * an operator searching Cloud Logging for `worker.boot.env_check`
 * always sees the full set of misconfigured envs before any
 * `requireEnv()` call throws, instead of having to backtrack from a
 * generic boot-failed error.
 *
 * Kept as a pre-flight check rather than wired into `requireEnv()`
 * itself because we want a SINGLE consolidated log line, not one per
 * missing var; and because some envs the worker checks lazily later
 * (e.g. KMS_KEY_RESOURCE inside the KMS provider factory) — listing
 * them up-front catches them before any other code path runs.
 *
 * Optional envs (SENTRY_DSN, ANTHROPIC_API_KEY) are excluded — their
 * absence is part of the no-op contract, not a misconfiguration.
 */
function auditRequiredEnv(): void {
  const required = [
    'DATABASE_URL',
    'REDIS_URL',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    // KMS or local-fallback — exactly one is fine; flag if both missing.
  ] as const;
  const missing = required.filter((k) => !process.env[k]);
  const kmsLocal = process.env.KMS_KEY_RESOURCE || process.env.ENCRYPTION_LOCAL_KEY;
  if (!kmsLocal) missing.push('KMS_KEY_RESOURCE_or_ENCRYPTION_LOCAL_KEY' as never);
  console.log(
    JSON.stringify({
      level: missing.length ? 'error' : 'info',
      kind: 'worker.boot.env_check',
      missing,
      present: required.filter((k) => process.env[k]).length,
      nodeEnv: process.env.NODE_ENV ?? 'unset',
    }),
  );
}

/**
 * Cloud Run health probe (D158). Cloud Run requires every Service to
 * listen on `$PORT` and pass a startup probe within ~4 minutes, even
 * for headless workers. This tiny HTTP server responds 200 to anything,
 * 503 only while `bootstrapComplete` is still false. Kept local — not
 * a NestJS app — so a Nest framework error never breaks the health
 * signal that keeps the revision serving.
 *
 * Has no effect locally (the local worker is started directly and
 * Cloud Run isn't probing it). PORT defaults to 8080 to match the
 * Cloud Run default but is respected if injected.
 */
let bootstrapComplete = false;
function startHealthServer(): void {
  // Lazy import keeps the import surface unchanged for local + tests.
  import('node:http')
    .then(({ createServer }) => {
      const port = Number.parseInt(process.env.PORT ?? '8080', 10);
      createServer((_req, res) => {
        res.statusCode = bootstrapComplete ? 200 : 503;
        res.end(bootstrapComplete ? 'ok' : 'starting');
      }).listen(port, () => {
        console.log(
          JSON.stringify({
            level: 'info',
            kind: 'worker.health_listening',
            port,
          }),
        );
      });
    })
    .catch((err: unknown) => {
      // Never let a health-server failure block worker boot — the boot
      // itself is the source of truth. Cloud Run will fail the revision
      // if the probe never succeeds; log it loudly.
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'worker.health_server_failed',
          message: error.message,
        }),
      );
    });
}

/**
 * Per-step boot tracer (2026-06-08 session). Emits one
 * `worker.boot.step` log line per major bootstrap phase so the
 * specific line that hangs is visible in Cloud Logging. Without this,
 * a bootstrap hang between `worker.health_listening` and
 * `worker.listening` is opaque — Cloud Run keeps the instance alive
 * (the health-server thread is fine) but BullMQ never attaches and no
 * downstream logs surface. With per-step traces, the LAST step ever
 * logged is the one that's hanging.
 */
function bootStep(name: string, extra?: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      level: 'info',
      kind: 'worker.boot.step',
      step: name,
      ts: Date.now(),
      ...extra,
    }),
  );
}

async function bootstrap(): Promise<void> {
  // Start the Cloud Run health server FIRST so the platform can probe
  // /any-path while the rest of bootstrap runs. The handler reports
  // 503 until `bootstrapComplete` flips at the end of this function,
  // so a half-booted worker never reports healthy. Critical: without
  // this, Cloud Run's startup probe on port 8080 times out at 4 min
  // and the revision is marked failed even though BullMQ is healthy.
  startHealthServer();
  bootStep('health_server_started');

  // Env audit BEFORE any `requireEnv()` call. Emits a single
  // `worker.boot.env_check` log line with the full list of missing
  // required envs — so a misconfigured deployment is one log search
  // away instead of "worker silently never logs `worker.listening`".
  auditRequiredEnv();
  bootStep('env_audit_complete');

  // D159: initialise Sentry before anything else so the worker process —
  // including the boot-time reconciler sweep — has the SDK installed for
  // any uncaught error path. No-op without `SENTRY_DSN` (mirrors the API
  // process; local dev + tests are unaffected).
  //
  // Gated behind `WORKER_SENTRY_ENABLED=true` (default OFF) because
  // `@sentry/node` v10's OTel default integrations monkey-patch
  // already-loaded modules at `Sentry.init()` time. The worker
  // entrypoint imports the full NestJS + Drizzle + BullMQ + Anthropic +
  // googleapis graph at the TOP of `worker.ts` before any code runs,
  // so by the time `initSentry()` executes those modules are already
  // in `require.cache`. Sentry's late-monkey-patch hangs the
  // bootstrap — observed live on Cloud Run worker revs that timed out
  // at 4 min. The proper fix is `node --import @sentry/node/preload …`
  // BEFORE `@swc-node/register` (tracked in FOUNDER-FOLLOWUPS as
  // "Sentry preload on worker"); until then this env gate keeps boot
  // reliable. Default OFF emits structured `worker.*` logs only,
  // which Cloud Logging captures normally. Privacy (D7) unchanged —
  // Sentry on the worker was always best-effort.
  const workerSentryEnabled = process.env.WORKER_SENTRY_ENABLED === 'true';
  bootStep('initSentry_begin', {
    dsnSet: Boolean(process.env.SENTRY_DSN),
    enabled: workerSentryEnabled,
  });
  if (workerSentryEnabled) {
    await initSentry();
  }
  bootStep('initSentry_done', { skipped: !workerSentryEnabled });
  bootStep('createSentryWorkerObserver_begin');
  const observer = workerSentryEnabled
    ? await createSentryWorkerObserver({ dsnSet: Boolean(process.env.SENTRY_DSN) })
    : await createSentryWorkerObserver({ dsnSet: false });
  bootStep('createSentryWorkerObserver_done');

  // `prepare: false` is REQUIRED when `DATABASE_URL` points at Supabase's
  // transaction-mode pooler (`*.pooler.supabase.com:6543`). The pooler
  // routes per-statement to whatever backend is free, so cached prepared-
  // statement names from a prior backend trigger
  // `prepared statement "X" does not exist` mid-tx → silent ROLLBACK of
  // multi-statement rebuilds (root cause of senders.total_received=0
  // shipping to prod 2026-06-08; ADR-0022). Setting prepare:false on
  // every `postgres()` call here forces simple-protocol queries. No-op
  // on direct connections (local dev `:5432`).
  const pg = postgres(requireEnv('DATABASE_URL'), { prepare: false });
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
  // prepare:false — same Supabase tx-pooler reason as `pg` above.
  const lockPg = postgres(requireEnv('DATABASE_URL'), {
    max: LABEL_ACTION_CONCURRENCY,
    prepare: false,
  });
  /** Advisory-lock namespace (first key) — isolates label-action locks. */
  const LABEL_ACTION_LOCK_NS = 0x4c41; // 'LA'
  // D181 audit writer. The worker is standalone (no Nest DI), so the
  // service is constructed directly against the worker's own `db`. The
  // service swallows its own insert failures so audit downtime never
  // breaks job processing.
  const securityEvents = new SecurityEventsService(db);

  // D181: wire the KMS provider with an access-error recorder so wrap /
  // unwrap failures on the worker's `tokenCrypto.decrypt(...)` path
  // (every getGmailClient call) surface as `kms.access_error` rows —
  // matches the Nest auth-crypto module's recorder for symmetry.
  const tokenCrypto = new TokenCryptoService(
    createKmsProvider(process.env, {
      onAccessError: ({ operation, reason, keyResource }) => {
        void securityEvents.record({
          eventType: 'kms.access_error',
          severity: 'critical',
          payload: { provider: 'gcp', operation, reason, keyResource },
        });
      },
    }),
  );
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
    // D181: close over the mailbox row's workspace/user so the audit
    // emit carries the operator-useful identifiers. Fire-and-forget —
    // a failed insert never alters the original token-swap throw.
    return new GmailClientService(oauth, limiter, ({ reason }) => {
      void securityEvents.record({
        eventType: 'oauth.refresh_failed',
        // `invalid_grant` means the mailbox needs reconnect (a real
        // operator signal); transient failures are routine retries and
        // stay at `info`.
        severity: reason === 'invalid_grant' ? 'warning' : 'info',
        workspaceId: account.workspaceId,
        userId: account.userId,
        payload: {
          provider: 'google',
          reason,
          mailboxAccountId,
        },
      });
    });
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

  /**
   * UndoExpiryWorker consumer + scheduler (D35, D58, D232 — cronPolicy).
   *
   * The worker hard-deletes `undo_journal` rows whose `expires_at` is
   * more than 1 day in the past (the 1-day lag gives the controller a
   * clean 410 boundary for just-expired tokens; see the worker class
   * header). Scheduler ticks every `UNDO_EXPIRY_INTERVAL_MS` (5 min)
   * — `enqueueUndoExpiryTick` is idempotent on `scheduledAtMinute` via
   * the BullMQ jobId, so cadence overlap collapses to one job per
   * minute.
   *
   * Wiring split out from the original PR that introduced the worker
   * class; ungated cron is fake completion (CLAUDE.md §10). Bundled
   * with the senders-counter reconciliation wiring below — both
   * cronPolicy workers had the same gap.
   */
  const undoExpiryWorker = new UndoExpiryWorker({ db });
  undoExpiryWorker.setObserver(observer);

  const undoExpiryBullWorker = new Worker<UndoExpiryJobData, UndoExpiryResult>(
    UNDO_EXPIRY_QUEUE,
    (job) => undoExpiryWorker.run(job),
    // cronPolicy is global-scope; one DELETE per tick is cheap, so
    // concurrency=1 prevents overlapping ticks from racing the same
    // jobId-deduped pass.
    { connection, concurrency: 1 },
  );

  undoExpiryBullWorker.on('error', (err) => {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'bullmq.error',
        queue: UNDO_EXPIRY_QUEUE,
        message: err.message,
      }),
    );
  });

  /**
   * SendersCounterReconciliationWorker consumer + scheduler (ADR-0014,
   * D159 — cronPolicy). Nightly recount of `senders.total_received`
   * against the source of truth in `mail_messages`. The metric
   * (corrected / maxAbsDelta / totalSenders) surfaces on the
   * `worker.succeeded` structured log via the D159 seam; downstream
   * dashboards read from there. See ADR-0014 §"Reconciliation & drift".
   */
  const sendersCounterReconciliationWorker = new SendersCounterReconciliationWorker({ db });
  sendersCounterReconciliationWorker.setObserver(observer);

  const sendersCounterReconciliationBullWorker = new Worker<
    SendersCounterReconciliationJobData,
    SendersCounterReconciliationResult
  >(SENDERS_COUNTER_RECONCILIATION_QUEUE, (job) => sendersCounterReconciliationWorker.run(job), {
    connection,
    concurrency: 1,
  });

  sendersCounterReconciliationBullWorker.on('error', (err) => {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'bullmq.error',
        queue: SENDERS_COUNTER_RECONCILIATION_QUEUE,
        message: err.message,
      }),
    );
  });

  /**
   * UndoExpiry + senders-counter reconciliation cron schedulers. Same
   * setInterval-based pattern as the Brief snapshot scheduler above —
   * scheduling rule lives in TypeScript (testable, reviewable) rather
   * than in BullMQ's repeatable-job Redis state. Each tick is
   * idempotent on `scheduledAtMinute` via the worker's `jobId`, so
   * redeploys + boot-time enqueues never produce duplicates.
   *
   * Boot enqueue + periodic enqueue mirror the Brief scheduler: the
   * boot tick covers the case where the worker was down across an
   * interval boundary; the worker's own logic (cron idempotency key +
   * deterministic recount) makes a same-minute re-run a no-op.
   */
  const undoExpirySchedulerQueue = new Queue<UndoExpiryJobData>(UNDO_EXPIRY_QUEUE, { connection });
  const sendersCounterReconciliationSchedulerQueue = new Queue<SendersCounterReconciliationJobData>(
    SENDERS_COUNTER_RECONCILIATION_QUEUE,
    { connection },
  );

  async function enqueueUndoExpiry(): Promise<void> {
    if (shuttingDown) return;
    try {
      await enqueueUndoExpiryTick(undoExpirySchedulerQueue);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'undo_expiry.scheduler_failed',
          message: error.message,
        }),
      );
      observer.captureBackgroundFailure(error, { kind: 'undo_expiry.scheduler_failed' });
    }
  }

  async function enqueueSendersCounterReconciliation(): Promise<void> {
    if (shuttingDown) return;
    try {
      await enqueueSendersCounterReconciliationTick(sendersCounterReconciliationSchedulerQueue);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'senders_counter_reconciliation.scheduler_failed',
          message: error.message,
        }),
      );
      observer.captureBackgroundFailure(error, {
        kind: 'senders_counter_reconciliation.scheduler_failed',
      });
    }
  }

  await enqueueUndoExpiry();
  const undoExpirySchedulerHandle = setInterval(() => {
    void enqueueUndoExpiry();
  }, UNDO_EXPIRY_INTERVAL_MS);
  undoExpirySchedulerHandle.unref();

  await enqueueSendersCounterReconciliation();
  const sendersCounterReconciliationSchedulerHandle = setInterval(() => {
    void enqueueSendersCounterReconciliation();
  }, SENDERS_COUNTER_RECONCILIATION_INTERVAL_MS);
  sendersCounterReconciliationSchedulerHandle.unref();

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
  console.log(
    JSON.stringify({ level: 'info', kind: 'worker.listening', queue: UNDO_EXPIRY_QUEUE }),
  );
  console.log(
    JSON.stringify({
      level: 'info',
      kind: 'worker.listening',
      queue: SENDERS_COUNTER_RECONCILIATION_QUEUE,
    }),
  );

  // Flip the health-server gate AFTER all BullMQ workers report
  // `worker.listening`. The HTTP server has been answering 503 since
  // `startHealthServer()` ran at the top of bootstrap; from this
  // point forward it answers 200 — Cloud Run's startup probe sees
  // healthy and the revision is marked Ready.
  bootstrapComplete = true;
  bootStep('bootstrap_complete');

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
    clearInterval(undoExpirySchedulerHandle);
    clearInterval(sendersCounterReconciliationSchedulerHandle);
    void (async () => {
      if (inFlight) {
        await inFlight;
      }
      await bullWorker.close();
      await briefSnapshotBullWorker.close();
      await briefSchedulerQueue.close();
      await scoreBullWorker.close();
      await labelActionBullWorker.close();
      await undoExpiryBullWorker.close();
      await undoExpirySchedulerQueue.close();
      await sendersCounterReconciliationBullWorker.close();
      await sendersCounterReconciliationSchedulerQueue.close();
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
