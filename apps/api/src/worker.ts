import 'reflect-metadata';

import Anthropic from '@anthropic-ai/sdk';
import { Queue, Worker } from 'bullmq';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, sql } from 'drizzle-orm';
import { OAuth2Client } from 'google-auth-library';
import postgres from 'postgres';
import { mailboxAccounts, providerSyncState, schema } from '@declutrmail/db';
import {
  AccountDeletionPurgeWorker,
  ACTION_RECOVERY_QUEUE,
  ActionRecoveryWorker,
  AUTOPILOT_ACTION_QUEUE,
  AUTOPILOT_APPLY_QUEUE,
  BRIEF_SNAPSHOT_INTERVAL_MS,
  BRIEF_SNAPSHOT_QUEUE,
  BriefSnapshotWorker,
  buildAutopilotApplyDeltaTrigger,
  createAutopilotExecutionChain,
  createRedisConnection,
  DEAD_LETTER_INTERVAL_MS,
  DEAD_LETTER_QUEUE,
  DeadLetterWorker,
  DELETION_SWEEP_INTERVAL_MS,
  DELETION_SWEEP_QUEUE,
  DrizzleDeadLetterRecorder,
  EMAIL_SEND_QUEUE,
  EmailSendWorker,
  ensureIncrementalSyncJob,
  ensureInitialSyncJob,
  enqueueBriefSnapshotTick,
  enqueueDeadLetterTick,
  enqueueDeletionSweepTick,
  enqueueFollowupCheckTick,
  enqueueSendersCounterReconciliationTick,
  enqueueSnoozeWakeTick,
  enqueueUndoExpiryTick,
  FOLLOWUP_CHECK_INTERVAL_MS,
  FOLLOWUP_CHECK_QUEUE,
  FollowupCheckWorker,
  INCREMENTAL_SYNC_QUEUE,
  IncrementalSyncWorker,
  INITIAL_SYNC_QUEUE,
  InitialSyncWorker,
  InvalidGrantError,
  LABEL_ACTION_QUEUE,
  LabelActionWorker,
  MAILBOX_ACTION_LOCK_NS,
  OUTBOX_NOTIFY_CHANNEL,
  OutboxDispatcherWorker,
  OutboxPublisher,
  RateLimiter,
  RedisSnoozeLabelMapStore,
  SCORE_JOB,
  SCORE_QUEUE,
  ScoreWorker,
  SENDERS_COUNTER_RECONCILIATION_INTERVAL_MS,
  SENDERS_COUNTER_RECONCILIATION_QUEUE,
  SendersCounterReconciliationWorker,
  SNOOZE_WAKE_INTERVAL_MS,
  SNOOZE_WAKE_QUEUE,
  SnoozeWakeWorker,
  FETCH_UNSUB_HTTP_PORT,
  UNDO_EXPIRY_INTERVAL_MS,
  UNDO_EXPIRY_QUEUE,
  UndoExpiryWorker,
  UNSUB_EXECUTION_JOB,
  UNSUB_EXECUTION_QUEUE,
  UnsubExecutionWorker,
  unsubExecutionJobOptions,
  ValidationError,
  enqueueWatchRenewalTick,
  resolveExplainTimeoutMs,
  WATCH_RENEWAL_INTERVAL_MS,
  WATCH_RENEWAL_QUEUE,
  WatchRenewalWorker,
  workerTuningOptions,
} from '@declutrmail/workers';
import type {
  ActionRecoveryJobData,
  ActionRecoveryResult,
  AutopilotActionJobData,
  AutopilotActionResult,
  AutopilotApplyJobData,
  AutopilotApplyJobResult,
  BriefSnapshotJobData,
  BriefSnapshotResult,
  DeadLetterSweepJobData,
  DeadLetterSweepResult,
  DeletionSweepJobData,
  DeletionSweepResult,
  EmailSendJobData,
  EmailSendResult,
  FollowupCheckJobData,
  FollowupCheckResult,
  GmailAccess,
  GmailMutationAccess,
  GmailWatchAccess,
  IncrementalSyncJobData,
  IncrementalSyncResult,
  InitialSyncJobData,
  InitialSyncResult,
  LabelActionJobData,
  LabelActionResult,
  MailboxActionLock,
  ScoreJobData,
  ScoreJobResult,
  SendersCounterReconciliationJobData,
  SendersCounterReconciliationResult,
  SnoozeWakeJobData,
  SnoozeWakeResult,
  UndoExpiryJobData,
  UndoExpiryResult,
  UnsubExecutionJobData,
  UnsubExecutionResult,
  WatchRenewalJobData,
  WatchRenewalResult,
} from '@declutrmail/workers';

import { AnthropicHaikuAdapter } from './adapters/anthropic-haiku.adapter.js';
import { buildBriefLlmAdapter } from './adapters/brief-llm-anthropic.adapter.js';
import { createKmsProvider } from './adapters/gcp-kms/kms-provider.factory.js';
import { TokenCryptoService } from './auth/token-crypto.service.js';
import { GmailClientService } from './gmail/gmail-client.service.js';
import { deletionReceiptEmail } from './notifications/email-templates.js';
import { EmailService } from './notifications/email.service.js';
import { EmailSuppressionService } from './notifications/email-suppression.service.js';
import { buildSyncReadyEmailHandler } from './notifications/sync-ready-email.trigger.js';
import { initSentry } from './observability/sentry.js';
import { createSentryWorkerObserver } from './observability/sentry-worker-observer.js';
import { SecurityEventsService } from './security-events/security-events.service.js';
import { buildOutboxConsumer } from './outbox/outbox-consumer-router.js';

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
  // so a half-booted worker never reports healthy.
  startHealthServer();
  bootStep('health_server_started');

  // Env audit BEFORE any `requireEnv()` call. Emits a single
  // `worker.boot.env_check` log line with the full list of missing
  // required envs — so a misconfigured deployment is one log search
  // away instead of "worker silently never logs `worker.listening`".
  auditRequiredEnv();
  bootStep('env_audit_complete');

  // Boot-refusal (mirrors the DEV_AUTH_ENABLED guard in main.ts):
  // `UNSUB_ALLOW_INSECURE_TARGETS` lets the unsub executor POST to
  // plain-http / loopback targets for LOCAL smoke only. In production
  // it would soften the SSRF posture, so the process refuses to start.
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.UNSUB_ALLOW_INSECURE_TARGETS === 'true'
  ) {
    throw new Error('UNSUB_ALLOW_INSECURE_TARGETS must never be set when NODE_ENV=production.');
  }

  // D159: initialise Sentry before anything else so the worker process —
  // including the boot-time reconciler sweep — has the SDK installed for
  // any uncaught error path. No-op without `SENTRY_DSN` (mirrors the API
  // process; local dev + tests are unaffected).
  //
  // 2026-06-08 session: `@sentry/node` v10 hangs the worker bootstrap
  // when initialized AFTER the NestJS / Drizzle / BullMQ / Anthropic
  // module graph is loaded (which `worker.ts` does at top-of-file
  // imports). Cloud Run worker rev 12 + 13 hung at `initSentry_begin`;
  // rev 14 + 15 hung at `createSentryWorkerObserver_begin` even with
  // `defaultIntegrations: false`. The correct long-term fix is to
  // preload Sentry via `node --import @sentry/node/preload …` BEFORE
  // `@swc-node/register` so OTel auto-instrumentation patches modules
  // at load time, not after. Tracked in FOUNDER-FOLLOWUPS as the
  // "Sentry preload on worker" item.
  //
  // Until then this gate keeps the worker boot reliable: set
  // `WORKER_SENTRY_ENABLED=true` to opt in once the preload flag is
  // wired. Default OFF emits structured `worker.*` logs only, which
  // Cloud Logging captures normally and which we wire alerts off via
  // log-based metrics. Privacy posture unchanged (D7) — Sentry on
  // the worker was always best-effort; structured logs are the canonical
  // signal.
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

  bootStep('postgres_pool_init');
  // `prepare: false` is REQUIRED when `DATABASE_URL` points at Supabase's
  // transaction-mode pooler (`*.pooler.supabase.com:6543`). The pooler
  // routes per-statement to whatever backend is free, so cached prepared-
  // statement names from a prior backend trigger
  // `prepared statement "X" does not exist` mid-tx → silent ROLLBACK of
  // multi-statement rebuilds (root cause of senders.total_received=0
  // shipping to prod 2026-06-08; ADR-0022). Setting prepare:false on
  // every `postgres()` call here forces simple-protocol queries.
  const pg = postgres(requireEnv('DATABASE_URL'), { prepare: false });
  const db = drizzle(pg, { schema });
  bootStep('postgres_pool_done');

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
  // D181 audit writer. The worker is standalone (no Nest DI), so the
  // service is constructed directly against the worker's own `db`. The
  // service swallows its own insert failures so audit downtime never
  // breaks job processing.
  const securityEvents = new SecurityEventsService(db);

  // D181: wire the KMS provider with an access-error recorder so wrap /
  // unwrap failures on the worker's `tokenCrypto.decrypt(...)` path
  // (every getGmailClient call) surface as `kms.access_error` rows —
  // matches the Nest auth-crypto module's recorder for symmetry.
  bootStep('kms_provider_init');
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
  bootStep('kms_provider_done');
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');
  bootStep('google_oauth_env_loaded');

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
    // 2026-06-08 session: structured trace per phase so a hang in
    // `getClient` (was opaque between `worker.started` and `worker.
    // failed/stalled`) is visible at single-line granularity. Phases:
    //   db_lookup  → SELECT mailbox row from Supabase
    //   kms_decrypt → unwrap encrypted OAuth refresh token via KMS
    //   oauth_init → build OAuth2Client + set credentials
    const t0 = Date.now();
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: 'info',
        kind: 'gmail.getClient.begin',
        mailboxAccountId,
      }),
    );
    const [account] = await db
      .select()
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.id, mailboxAccountId))
      .limit(1);
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: 'info',
        kind: 'gmail.getClient.db_lookup_done',
        mailboxAccountId,
        durationMs: Date.now() - t0,
        found: Boolean(account),
      }),
    );
    if (!account) {
      throw new ValidationError(`mailbox account ${mailboxAccountId} not found`);
    }
    if (!account.encryptedRefreshToken || !account.dekEncrypted) {
      throw new InvalidGrantError(`mailbox account ${mailboxAccountId} has no stored OAuth token`);
    }
    const tKms = Date.now();
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: 'info',
        kind: 'gmail.getClient.kms_decrypt_begin',
        mailboxAccountId,
      }),
    );
    const refreshToken = await tokenCrypto.decrypt(
      account.encryptedRefreshToken,
      account.dekEncrypted,
    );
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: 'info',
        kind: 'gmail.getClient.kms_decrypt_done',
        mailboxAccountId,
        kmsDurationMs: Date.now() - tKms,
      }),
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
  // `GmailClientService` implements the watch lifecycle port too
  // (`users.watch` / `users.stop`), so the same token-bound factory
  // serves the WatchRenewalWorker (D225).
  const gmailWatchAccess: GmailWatchAccess = { getClient: getGmailClient };

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
        await reserved`SELECT pg_advisory_lock(${MAILBOX_ACTION_LOCK_NS}, hashtext(${mailboxAccountId}))`;
        return await fn();
      } finally {
        try {
          await reserved`SELECT pg_advisory_unlock(${MAILBOX_ACTION_LOCK_NS}, hashtext(${mailboxAccountId}))`;
        } catch {
          // Best-effort unlock; the session ending releases it regardless.
        }
        reserved.release();
      }
    },
  };

  bootStep('redis_connection_init');
  const connection = createRedisConnection(requireEnv('REDIS_URL'));
  bootStep('redis_connection_done');

  // BullMQ idle-poll tuning (2026-06-10 Upstash command-volume audit).
  // Resolved once; spread into every Worker constructor below. Pickup
  // latency is unaffected — `Queue.add` unblocks the worker's blocking
  // pop immediately via the `{queue}:marker` zset — so user-facing
  // queues stay snappy while cron queues poll slowly. See
  // `workerTuningOptions` in `packages/workers/src/queue.ts`.
  const userFacingTuning = workerTuningOptions('user-facing');
  const cronTuning = workerTuningOptions('cron');
  // Echo effective values so a misconfigured env (e.g. cron drainDelay
  // back at 5s, silently re-inflating Redis command volume) is
  // diagnosable from boot logs instead of the Upstash bill.
  bootStep('worker_tuning_resolved', { userFacingTuning, cronTuning });

  /**
   * Dead-letter recorder (D225 — U29/#208). Installed on EVERY
   * BaseDeclutrWorker instance below, next to its `setObserver()` call,
   * so terminal failures park durably in `dead_letter_jobs` instead of
   * living only in Redis's capped failed set. The `DeadLetterWorker`
   * sweep (registered further down) alerts once per parked row.
   */
  const deadLetterRecorder = new DrizzleDeadLetterRecorder({ db });
  bootStep('dead_letter_recorder_constructed');

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
    // U14/U-WIRE: publish `mailbox.sync_ready` in the ready transition
    // (transactional outbox) — drives preset seeding, the Autopilot
    // apply sweep, and the D6 sync-complete email via the consumer
    // router below. Without this dep the worker WARNs
    // `sync.sync_ready_publish_skipped` on every ready flip.
    outbox: new OutboxPublisher(),
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
  initialSync.setDeadLetterRecorder(deadLetterRecorder);

  const bullWorker = new Worker<InitialSyncJobData, InitialSyncResult>(
    INITIAL_SYNC_QUEUE,
    (job) => initialSync.run(job),
    // concurrency = D203 global queue cap; per-mailbox=1 is enforced by
    // the `jobId = mailboxAccountId` dedup in `initialSyncJobOptions`.
    { connection, concurrency: 20, ...userFacingTuning },
  );

  bullWorker.on('error', (err) => {
    console.error(JSON.stringify({ level: 'error', kind: 'bullmq.error', message: err.message }));
  });

  // Autopilot apply-queue PRODUCER — constructed here (above the
  // IncrementalSyncWorker that fires it); the CONSUMER + the rest of
  // the autopilot execution chain are registered further down with the
  // other autopilot queues. Also handed to the outbox consumer router
  // (sync_ready + score_run_completed producers) below.
  const autopilotApplyQueue = new Queue<AutopilotApplyJobData>(AUTOPILOT_APPLY_QUEUE, {
    connection,
  });

  // IncrementalSyncWorker consumer (D8, D229 follow-up). Producer side
  // is the webhook (`WebhooksModule` enqueues on every verified Pub/Sub
  // push); consumer runs here in the same worker process so the
  // observer/D159 seam shares wiring with InitialSyncWorker. BullMQ jobId
  // namespacing deduplicates an identical historyId but does NOT serialize
  // different historyIds for one mailbox. Run the complete sync lifecycle
  // under the same cross-process mailbox advisory lock as label actions so
  // overlapping history jobs cannot double-apply deltas or race mutations.
  const incrementalSync = new IncrementalSyncWorker({
    db,
    gmailAccess,
    // First-seen sender → single-sender score job (D25 signal_change
    // trigger; D75 incremental path). The ScoreWorker's Phase-B branch
    // is what flags the sender into `screener_quarantine` — this only
    // produces the trigger. jobId matches ScoreWorker's idempotency
    // key shape so a BullMQ redelivery of the same trigger dedups.
    onNewSender: async (mailboxAccountId, senderKey) => {
      const producedAtMs = Date.now();
      await scoreProducerQueue.add(
        SCORE_JOB,
        { mailboxAccountId, senderKey, trigger: 'signal_change', producedAtMs },
        { jobId: `${mailboxAccountId}:${senderKey}:${producedAtMs}` },
      );
    },
    // Delta processed → debounced Autopilot apply sweep (D100 "on new
    // message arrival"; 2026-07-07 P0 — known-sender mail never
    // re-triggered enabled rules because score runs only fire via
    // onNewSender above). The trigger collapses a webhook burst into
    // one sweep per 5-min window via the window-end jobId + delay.
    onDeltaProcessed: buildAutopilotApplyDeltaTrigger(autopilotApplyQueue),
  });
  incrementalSync.setObserver(observer);
  incrementalSync.setDeadLetterRecorder(deadLetterRecorder);
  const incrementalBullWorker = new Worker<IncrementalSyncJobData, IncrementalSyncResult>(
    INCREMENTAL_SYNC_QUEUE,
    (job) => mailboxLock.run(job.data.mailboxAccountId, () => incrementalSync.run(job)),
    { connection, concurrency: 20, ...userFacingTuning },
  );
  incrementalBullWorker.on('error', (err) => {
    console.error(JSON.stringify({ level: 'error', kind: 'bullmq.error', message: err.message }));
  });
  // Cursor-too-old recovery (flow-completeness-auditor 2026-06-05 🔴-1):
  // when Gmail's history.list returns 404 (startHistoryId older than D5's
  // 7-day retention window), the IncrementalSyncWorker returns
  // `{ cursorTooOld: true, advancedToHistoryId: null }` and exits — the
  // cursor stays put deliberately. Without a consumer of that signal the
  // mailbox stays stale until manual reconnect. This onCompleted hook
  // re-enqueues a forced InitialSyncWorker run to fetch the full mailbox
  // from a fresh historyId snapshot (`force: true` reaps any stale
  // pending initial-sync job so the new attempt isn't blocked).
  // Best-effort — a failed re-enqueue is WARN-logged; the nightly
  // reconciler is the backup recovery surface.
  incrementalBullWorker.on('completed', (job, result: IncrementalSyncResult) => {
    if (!result?.cursorTooOld) {
      return;
    }
    const { mailboxAccountId } = job.data as IncrementalSyncJobData;
    void (async () => {
      try {
        // A forced job alone is insufficient: InitialSyncWorker refuses
        // to re-run a mailbox still marked ready. Reset the durable gate
        // and clear the expired applied cursor before scheduling the full
        // resync; the worker captures a fresh base snapshot on entry.
        await db
          .update(providerSyncState)
          .set({
            readinessStatus: 'queued',
            currentStage: 'queued',
            progressPct: 0,
            lastHistoryId: null,
            historyIdUpdatedAt: null,
            lastIncrementalErrorAt: null,
            lastIncrementalErrorCode: null,
            updatedAt: new Date(),
          })
          .where(eq(providerSyncState.mailboxAccountId, mailboxAccountId));
        const outcome = await ensureInitialSyncJob(reconcilerQueue, mailboxAccountId, {
          force: true,
        });
        console.log(
          JSON.stringify({
            level: 'info',
            kind: 'sync.cursor_recovery_scheduled',
            mailboxAccountId,
            jobId: job.id,
            initialSyncOutcome: outcome,
          }),
        );
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            kind: 'sync.cursor_recovery_failed',
            mailboxAccountId,
            jobId: job.id,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    })();
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
  briefSnapshotWorker.setDeadLetterRecorder(deadLetterRecorder);

  const briefSnapshotBullWorker = new Worker<BriefSnapshotJobData, BriefSnapshotResult>(
    BRIEF_SNAPSHOT_QUEUE,
    (job) => briefSnapshotWorker.run(job),
    // cronPolicy is global-scope; the worker's internal per-mailbox
    // fan-out (`BRIEF_SNAPSHOT_CONCURRENCY`) handles parallelism within
    // a single job. Outer concurrency=1 keeps ticks from overlapping
    // — D69's per-mailbox UNIQUE makes overlap safe, but skipping
    // duplicate work is cheaper.
    { connection, concurrency: 1, ...cronTuning },
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
  // Client timeout matches the scoreOne race budget so a timed-out
  // call is ABORTED at the socket instead of orphaned to complete
  // (and bill) in the background. maxRetries=1 keeps the SDK's silent
  // retry backoff inside that budget — the default 2 retries could
  // eat the whole window and register as a reasoning.timeout.
  const reasoningLlm = process.env.ANTHROPIC_API_KEY
    ? new AnthropicHaikuAdapter({
        client: new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
          timeout: resolveExplainTimeoutMs(process.env.REASONING_TIMEOUT_MS),
          maxRetries: 1,
        }),
      })
    : undefined;
  // U14/U-WIRE: `outbox` publishes `triage.score_run_completed` after
  // each run — the consumer router (below) turns it into an Autopilot
  // apply sweep. Without it the worker WARNs
  // `score.run_completed_publish_skipped` per run.
  const scoreWorker = new ScoreWorker(
    reasoningLlm
      ? { db, llm: reasoningLlm, outbox: new OutboxPublisher() }
      : { db, outbox: new OutboxPublisher() },
  );
  scoreWorker.setObserver(observer);
  scoreWorker.setDeadLetterRecorder(deadLetterRecorder);

  const scoreBullWorker = new Worker<ScoreJobData, ScoreJobResult>(
    SCORE_QUEUE,
    (job) => scoreWorker.run(job),
    { connection, concurrency: 20, ...userFacingTuning },
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
  labelActionWorker.setDeadLetterRecorder(deadLetterRecorder);

  const labelActionBullWorker = new Worker<LabelActionJobData, LabelActionResult>(
    LABEL_ACTION_QUEUE,
    (job) => labelActionWorker.run(job),
    // Bounded to the dedicated `lockPg` pool size — every job holds one
    // advisory-lock connection for its full duration.
    { connection, concurrency: LABEL_ACTION_CONCURRENCY, ...userFacingTuning },
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

  /**
   * Read-only recovery verifier (D169/D170). Failed Archive, Later,
   * and Delete actions are never blindly replayed: this consumer reads
   * fresh Gmail metadata and persists an expiring consequence preview.
   * A separate, explicit confirmation creates the linked label action.
   */
  const actionRecoveryWorker = new ActionRecoveryWorker({
    db,
    gmail: gmailAccess,
  });
  actionRecoveryWorker.setObserver(observer);
  actionRecoveryWorker.setDeadLetterRecorder(deadLetterRecorder);

  const actionRecoveryBullWorker = new Worker<ActionRecoveryJobData, ActionRecoveryResult>(
    ACTION_RECOVERY_QUEUE,
    (job) => actionRecoveryWorker.run(job),
    { connection, concurrency: 10, ...userFacingTuning },
  );

  actionRecoveryBullWorker.on('error', (err) => {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'bullmq.error',
        queue: ACTION_RECOVERY_QUEUE,
        message: err.message,
      }),
    );
  });

  /**
   * UnsubExecutionWorker consumer (D9 Wave 2). Executes RFC 8058
   * one-click unsubscribes for senders whose intent was recorded
   * against a `one_click` method. Producer side lives in
   * `ActionsModule` (POST /api/actions/unsubscribe-intent). No Gmail
   * client, no advisory lock — the worker POSTs to third-party list
   * processors and writes its terminal tx against `pg`. Retry budget
   * is the worker's own (`UNSUB_MAX_ATTEMPTS = 2`, network errors
   * only) — a 4xx/5xx from the target is terminal on attempt 1.
   * Modest concurrency: unsubscribes are click-paced, not a
   * throughput path.
   */
  const unsubExecutionWorker = new UnsubExecutionWorker({
    db,
    http: FETCH_UNSUB_HTTP_PORT,
    outbox: new OutboxPublisher(),
    allowInsecureTargets: process.env.UNSUB_ALLOW_INSECURE_TARGETS === 'true',
  });
  unsubExecutionWorker.setObserver(observer);
  unsubExecutionWorker.setDeadLetterRecorder(deadLetterRecorder);

  const unsubExecutionBullWorker = new Worker<UnsubExecutionJobData, UnsubExecutionResult>(
    UNSUB_EXECUTION_QUEUE,
    (job) => unsubExecutionWorker.run(job),
    { connection, concurrency: 5 },
  );

  unsubExecutionBullWorker.on('error', (err) => {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'bullmq.error',
        queue: UNSUB_EXECUTION_QUEUE,
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
  undoExpiryWorker.setDeadLetterRecorder(deadLetterRecorder);

  const undoExpiryBullWorker = new Worker<UndoExpiryJobData, UndoExpiryResult>(
    UNDO_EXPIRY_QUEUE,
    (job) => undoExpiryWorker.run(job),
    // cronPolicy is global-scope; one DELETE per tick is cheap, so
    // concurrency=1 prevents overlapping ticks from racing the same
    // jobId-deduped pass.
    { connection, concurrency: 1, ...cronTuning },
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
  sendersCounterReconciliationWorker.setDeadLetterRecorder(deadLetterRecorder);

  const sendersCounterReconciliationBullWorker = new Worker<
    SendersCounterReconciliationJobData,
    SendersCounterReconciliationResult
  >(SENDERS_COUNTER_RECONCILIATION_QUEUE, (job) => sendersCounterReconciliationWorker.run(job), {
    connection,
    concurrency: 1,
    ...cronTuning,
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

  /**
   * WatchRenewalWorker consumer + scheduler (D8, D225, D229 —
   * cronPolicy). Re-watches every active, sync-ready mailbox so its
   * Gmail `users.watch` subscription (which expires ~7 days after the
   * connect-time watch) never lapses — without this sweep the Pub/Sub
   * push webhook goes silent mailbox-wide within a week. Same
   * setInterval pattern as the cron workers above: the boot enqueue
   * covers downtime across a 6h boundary, the BullMQ
   * `jobId = WatchRenewalWorker:<minute>` dedups the tick, and the
   * worker's `cron_runs` claim makes a double-fire a durable no-op.
   *
   * `GMAIL_PUBSUB_TOPIC` unset (local dev / not-yet-provisioned env) →
   * the worker stays REGISTERED but every sweep returns
   * `skipped_disabled` without touching Gmail or `cron_runs` — mirrors
   * `GmailWatchService`'s connect-time guard.
   */
  const gmailPubsubTopic = process.env.GMAIL_PUBSUB_TOPIC || null;
  const watchRenewalWorker = new WatchRenewalWorker({
    db,
    gmailWatch: gmailWatchAccess,
    topicName: gmailPubsubTopic,
    // Per-mailbox failure seam (record-and-continue isolation); the
    // base-class observer below captures TERMINAL job failures.
    observer,
  });
  watchRenewalWorker.setObserver(observer);
  watchRenewalWorker.setDeadLetterRecorder(deadLetterRecorder);

  const watchRenewalBullWorker = new Worker<WatchRenewalJobData, WatchRenewalResult>(
    WATCH_RENEWAL_QUEUE,
    (job) => watchRenewalWorker.run(job),
    // One sweep at a time — `users.watch` is cheap and the sweep is
    // already jobId-deduped, so overlapping ticks have nothing to win.
    { connection, concurrency: 1, ...cronTuning },
  );

  watchRenewalBullWorker.on('error', (err) => {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'bullmq.error',
        queue: WATCH_RENEWAL_QUEUE,
        message: err.message,
      }),
    );
  });

  const watchRenewalSchedulerQueue = new Queue<WatchRenewalJobData>(WATCH_RENEWAL_QUEUE, {
    connection,
  });

  async function enqueueWatchRenewal(): Promise<void> {
    if (shuttingDown) return;
    try {
      await enqueueWatchRenewalTick(watchRenewalSchedulerQueue);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'watch_renewal.scheduler_failed',
          message: error.message,
        }),
      );
      observer.captureBackgroundFailure(error, { kind: 'watch_renewal.scheduler_failed' });
    }
  }

  await enqueueWatchRenewal();
  const watchRenewalSchedulerHandle = setInterval(() => {
    void enqueueWatchRenewal();
  }, WATCH_RENEWAL_INTERVAL_MS);
  watchRenewalSchedulerHandle.unref();

  /**
   * Incremental-sync drift sweeper (D38 prod-ready pass).
   *
   * Every `INCREMENTAL_DRIFT_INTERVAL_MS`, enqueue an incremental-sync
   * job for every mailbox whose `provider_sync_state.last_history_id`
   * hasn't advanced in `INCREMENTAL_DRIFT_STALE_AFTER_MS` (10 minutes
   * by default). This handles:
   *   1. **Local dev** — no Pub/Sub topic is registered, so without
   *      this sweep new emails are never reconciled until the user
   *      clicks "Sync now".
   *   2. **Pub/Sub outage** — if a push delivery is lost (Pub/Sub is
   *      at-least-once but not exactly-once across retries), the drift
   *      sweep catches it within 10 minutes.
   *   3. **Pub/Sub still rolling out** — until `users.watch` is wired,
   *      every mailbox is in this state.
   *
   * Idempotent end-to-end:
   *   - `ensureIncrementalSyncJob` dedups by `${mailbox}:${cursor}` so
   *     a sweep that fires while the previous one's job is still in
   *     flight is a no-op.
   *   - The worker advances the cursor on success, so the NEXT sweep
   *     sees a different `${cursor}` and (correctly) enqueues a new
   *     job — Gmail history may have advanced since.
   */
  const incrementalReconcilerQueue = new Queue<IncrementalSyncJobData>(INCREMENTAL_SYNC_QUEUE, {
    connection,
  });
  const INCREMENTAL_DRIFT_INTERVAL_MS = 5 * 60 * 1000;
  const INCREMENTAL_DRIFT_STALE_AFTER_MS = 10 * 60 * 1000;
  const INCREMENTAL_DRIFT_BATCH = 100;

  async function driftSweepIncrementalSync(): Promise<void> {
    if (shuttingDown) return;
    try {
      const cutoff = sql`now() - interval '${sql.raw(
        String(INCREMENTAL_DRIFT_STALE_AFTER_MS),
      )} milliseconds'`;
      const rows = await db
        .select({
          mailboxAccountId: providerSyncState.mailboxAccountId,
          lastHistoryId: providerSyncState.lastHistoryId,
        })
        .from(providerSyncState)
        .innerJoin(mailboxAccounts, eq(providerSyncState.mailboxAccountId, mailboxAccounts.id))
        .where(
          and(
            eq(mailboxAccounts.status, 'active'),
            eq(providerSyncState.readinessStatus, 'ready'),
            sql`${providerSyncState.lastHistoryId} IS NOT NULL AND ${providerSyncState.historyIdUpdatedAt} < ${cutoff}`,
          ),
        )
        .limit(INCREMENTAL_DRIFT_BATCH);

      let enqueued = 0;
      let noop = 0;
      for (const row of rows) {
        if (shuttingDown) break;
        if (row.lastHistoryId === null) continue;
        const cursor = row.lastHistoryId.toString();
        const outcome = await ensureIncrementalSyncJob(incrementalReconcilerQueue, {
          mailboxAccountId: row.mailboxAccountId,
          startHistoryId: cursor,
          endHistoryId: cursor,
        });
        if (outcome === 'added') enqueued += 1;
        else noop += 1;
      }

      if (enqueued > 0 || noop > 0) {
        console.log(
          JSON.stringify({
            level: 'info',
            kind: 'incremental_drift.swept',
            enqueued,
            noop,
            scanned: rows.length,
          }),
        );
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'incremental_drift.failed',
          message: error.message,
        }),
      );
      // D159 seam — same as the initial-sync reconciler above.
      observer.captureBackgroundFailure(error, { kind: 'incremental_drift.failed' });
    }
  }

  /**
   * Overlap + defense-in-depth wrapper for the drift-sweep tick.
   * Mirrors the initial-sync reconciler's `inFlight + tick + .catch`
   * pattern (silent-failure-hunter 2026-06-06 — the drift sweep was
   * missing both guards; a future refactor that moves a line out of
   * `driftSweepIncrementalSync`'s inner try/catch would leak an
   * unhandled rejection straight to Node, and a slow sweep that
   * exceeds the 5-min interval would race itself).
   */
  let driftInFlight: Promise<void> | null = null;
  function driftTick(): void {
    if (shuttingDown || driftInFlight) return;
    const p = driftSweepIncrementalSync()
      .then(() => undefined)
      .finally(() => {
        driftInFlight = null;
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'incremental_drift.tick_unexpected',
            message: error.message,
          }),
        );
        observer.captureBackgroundFailure(error, {
          kind: 'incremental_drift.tick_unexpected',
        });
      });
    driftInFlight = p;
  }

  // Boot sweep so a worker restart immediately catches up any mailbox
  // that drifted during the deploy gap. Routed through the same
  // `driftTick` so the inFlight slot is honored at shutdown.
  driftTick();
  if (driftInFlight) {
    await driftInFlight;
  }
  const incrementalDriftHandle = setInterval(driftTick, INCREMENTAL_DRIFT_INTERVAL_MS);
  incrementalDriftHandle.unref();

  /**
   * EmailSendWorker consumer (D162, D6 — batchPolicy per D225). Sends
   * the transactional emails enqueued by the sync-ready outbox trigger
   * (below), the deletion pipeline, and the 24h reminder. Delivery is
   * `EmailService` — FAIL-CLOSED when `RESEND_API_KEY` is unset: the
   * service logs once at construction, every send returns a typed
   * `disabled` refusal, and the worker maps that to a `PermanentError`
   * (dead-letter + one Sentry capture, never a retry loop, never a
   * boot crash). The same queue instance is the PRODUCER handed to the
   * sync-ready email trigger and the deletion purge worker.
   */
  const emailSendQueue = new Queue<EmailSendJobData>(EMAIL_SEND_QUEUE, { connection });
  const emailSendWorker = new EmailSendWorker({
    db,
    delivery: new EmailService(new EmailSuppressionService(db)),
  });
  emailSendWorker.setObserver(observer);
  emailSendWorker.setDeadLetterRecorder(deadLetterRecorder);
  const emailSendBullWorker = new Worker<EmailSendJobData, EmailSendResult>(
    EMAIL_SEND_QUEUE,
    (job) => emailSendWorker.run(job),
    { connection, concurrency: 5, ...userFacingTuning },
  );
  emailSendBullWorker.on('error', (err) => {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'bullmq.error',
        queue: EMAIL_SEND_QUEUE,
        message: err.message,
      }),
    );
  });

  /**
   * Autopilot execution chain (D99/D101/D104, D226 — perMailboxPolicy;
   * quiet-hours deferral D92/D93). `createAutopilotExecutionChain`
   * wires the pair: the APPLY worker matches enabled rules against
   * fresh triage decisions and, when Active-mode matches land, enqueues
   * one ACTION sweep; the ACTION worker executes matched intents
   * through the same terminal-tx pipeline as LabelActionWorker (same
   * per-mailbox advisory lock, same outbox publisher) and re-enqueues
   * a DELAYED sweep when a quiet window defers it. One-click unsub
   * intents route to the existing `unsub-execution` queue via its
   * canonical job options. Producers: the outbox consumer router
   * (sync_ready + score_run_completed → apply queue, wired below), the
   * incremental-sync delta trigger (`autopilotApplyQueue` constructed
   * next to the IncrementalSyncWorker above), and the API's approve
   * endpoints (action queue).
   */
  const autopilotActionQueue = new Queue<AutopilotActionJobData>(AUTOPILOT_ACTION_QUEUE, {
    connection,
  });
  const unsubExecutionProducerQueue = new Queue<UnsubExecutionJobData>(UNSUB_EXECUTION_QUEUE, {
    connection,
  });
  const { applyWorker: autopilotApplyWorker, actionWorker: autopilotActionWorker } =
    createAutopilotExecutionChain({
      db,
      gmailMutation: gmailMutationAccess,
      outbox: new OutboxPublisher(),
      lock: mailboxLock,
      actionQueue: autopilotActionQueue,
      enqueueUnsubExecution: async (data) => {
        await unsubExecutionProducerQueue.add(
          UNSUB_EXECUTION_JOB,
          data,
          unsubExecutionJobOptions(data.idempotencyKey),
        );
      },
    });
  autopilotApplyWorker.setObserver(observer);
  autopilotApplyWorker.setDeadLetterRecorder(deadLetterRecorder);
  autopilotActionWorker.setObserver(observer);
  autopilotActionWorker.setDeadLetterRecorder(deadLetterRecorder);

  const autopilotApplyBullWorker = new Worker<AutopilotApplyJobData, AutopilotApplyJobResult>(
    AUTOPILOT_APPLY_QUEUE,
    (job) => autopilotApplyWorker.run(job),
    // Matcher sweeps are DB-only (no Gmail, no lock); modest parallelism
    // across mailboxes is plenty — sweeps are event-paced, not throughput.
    { connection, concurrency: 5, ...userFacingTuning },
  );
  autopilotApplyBullWorker.on('error', (err) => {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'bullmq.error',
        queue: AUTOPILOT_APPLY_QUEUE,
        message: err.message,
      }),
    );
  });

  const autopilotActionBullWorker = new Worker<AutopilotActionJobData, AutopilotActionResult>(
    AUTOPILOT_ACTION_QUEUE,
    (job) => autopilotActionWorker.run(job),
    // Each sweep holds a `lockPg` advisory-lock connection for its full
    // duration, sharing the max-10 pool with LabelActionWorker
    // (concurrency 10). Combined peak demand is 15 > 10 — an ACCEPTED
    // overcommit: `reserve()` queues (never fails), a lock holder's
    // inner queries run on the separate main `pg` pool so it always
    // completes and releases (no hold-and-wait deadlock), and both
    // queues are event-paced, not throughput-bound. Worst case under
    // simultaneous max load: up to 5 sweeps idle in the reserve queue.
    { connection, concurrency: 5, ...userFacingTuning },
  );
  autopilotActionBullWorker.on('error', (err) => {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'bullmq.error',
        queue: AUTOPILOT_ACTION_QUEUE,
        message: err.message,
      }),
    );
  });

  /**
   * SnoozeWakeWorker consumer + 15-min tick scheduler (D78/D79/D80 —
   * cronPolicy). The sweep wakes due sender snoozes (restores INBOX +
   * removes the per-mailbox Later label via batchModify, clears the
   * timer) and publishes the Later-label-id mapping to Redis so the
   * `/api/snoozed` list read never needs a Gmail client. Targeted
   * `wake` jobs come from POST /api/snoozed/:senderId/wake.
   */
  const snoozeWakeWorker = new SnoozeWakeWorker({
    db,
    gmailMutation: gmailMutationAccess,
    labelMap: new RedisSnoozeLabelMapStore(connection),
    lock: mailboxLock,
  });
  snoozeWakeWorker.setObserver(observer);
  snoozeWakeWorker.setDeadLetterRecorder(deadLetterRecorder);
  const snoozeWakeBullWorker = new Worker<SnoozeWakeJobData, SnoozeWakeResult>(
    SNOOZE_WAKE_QUEUE,
    (job) => snoozeWakeWorker.run(job),
    { connection, concurrency: 1, ...cronTuning },
  );
  snoozeWakeBullWorker.on('error', (err) => {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'bullmq.error',
        queue: SNOOZE_WAKE_QUEUE,
        message: err.message,
      }),
    );
  });

  const snoozeWakeSchedulerQueue = new Queue<SnoozeWakeJobData>(SNOOZE_WAKE_QUEUE, { connection });

  async function enqueueSnoozeWake(): Promise<void> {
    if (shuttingDown) return;
    try {
      await enqueueSnoozeWakeTick(snoozeWakeSchedulerQueue);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'snooze_wake.scheduler_failed',
          message: error.message,
        }),
      );
      observer.captureBackgroundFailure(error, { kind: 'snooze_wake.scheduler_failed' });
    }
  }

  await enqueueSnoozeWake();
  const snoozeWakeSchedulerHandle = setInterval(() => {
    void enqueueSnoozeWake();
  }, SNOOZE_WAKE_INTERVAL_MS);
  snoozeWakeSchedulerHandle.unref();

  /**
   * DeadLetterWorker sweep + 60s scheduler (D225 — adminPolicy). Scans
   * `dead_letter_jobs` for unreplayed rows and alerts exactly once per
   * row per process lifetime: one `dead_letter.parked` error log + one
   * `observer.captureBackgroundFailure()`. Replay is the MANUAL-only
   * `replayDeadLetterJob` helper — nothing auto-replays (D233 spirit).
   * Self-parking (the recorder installed on this worker too) is safe:
   * bounded, and the next sweep surfaces it.
   */
  const deadLetterWorker = new DeadLetterWorker({ db, observer });
  deadLetterWorker.setObserver(observer);
  deadLetterWorker.setDeadLetterRecorder(deadLetterRecorder);
  const deadLetterBullWorker = new Worker<DeadLetterSweepJobData, DeadLetterSweepResult>(
    DEAD_LETTER_QUEUE,
    (job) => deadLetterWorker.run(job),
    { connection, concurrency: 1, ...cronTuning },
  );
  deadLetterBullWorker.on('error', (err) => {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'bullmq.error',
        queue: DEAD_LETTER_QUEUE,
        message: err.message,
      }),
    );
  });

  const deadLetterSchedulerQueue = new Queue<DeadLetterSweepJobData>(DEAD_LETTER_QUEUE, {
    connection,
  });

  async function enqueueDeadLetter(): Promise<void> {
    if (shuttingDown) return;
    try {
      await enqueueDeadLetterTick(deadLetterSchedulerQueue);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'dead_letter.scheduler_failed',
          message: error.message,
        }),
      );
      observer.captureBackgroundFailure(error, { kind: 'dead_letter.scheduler_failed' });
    }
  }

  await enqueueDeadLetter();
  const deadLetterSchedulerHandle = setInterval(() => {
    void enqueueDeadLetter();
  }, DEAD_LETTER_INTERVAL_MS);
  deadLetterSchedulerHandle.unref();

  /**
   * AccountDeletionPurgeWorker + 5-min sweep (D205/D216/D232 —
   * cronPolicy). Purges due deletion requests: stop watches
   * (best-effort) → enqueue the receipt email (via `emailSendQueue`
   * above, `recipientOverride` because the user row is gone at send
   * time) → audit row → chunked data drop. `gmailPubsubTopic` null
   * (local dev) skips the `users.stop` calls, mirroring
   * GmailWatchService.
   */
  const deletionPurgeWorker = new AccountDeletionPurgeWorker({
    db,
    gmailWatch: gmailWatchAccess,
    topicName: gmailPubsubTopic,
    emailQueue: emailSendQueue,
    renderReceiptEmail: deletionReceiptEmail,
    mailboxLock,
    observer,
  });
  deletionPurgeWorker.setObserver(observer);
  deletionPurgeWorker.setDeadLetterRecorder(deadLetterRecorder);
  const deletionSweepBullWorker = new Worker<DeletionSweepJobData, DeletionSweepResult>(
    DELETION_SWEEP_QUEUE,
    (job) => deletionPurgeWorker.run(job),
    { connection, concurrency: 1, ...cronTuning },
  );
  deletionSweepBullWorker.on('error', (err) => {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'bullmq.error',
        queue: DELETION_SWEEP_QUEUE,
        message: err.message,
      }),
    );
  });

  const deletionSweepSchedulerQueue = new Queue<DeletionSweepJobData>(DELETION_SWEEP_QUEUE, {
    connection,
  });

  async function enqueueDeletionSweep(): Promise<void> {
    if (shuttingDown) return;
    try {
      await enqueueDeletionSweepTick(deletionSweepSchedulerQueue);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'deletion_sweep.scheduler_failed',
          message: error.message,
        }),
      );
      observer.captureBackgroundFailure(error, { kind: 'deletion_sweep.scheduler_failed' });
    }
  }

  await enqueueDeletionSweep();
  const deletionSweepSchedulerHandle = setInterval(() => {
    void enqueueDeletionSweep();
  }, DELETION_SWEEP_INTERVAL_MS);
  deletionSweepSchedulerHandle.unref();

  /**
   * FollowupCheckWorker + 6h cron (D84/D85/D87/D88 — cronPolicy).
   * Materializes `followup_tracker` rows from outbound mail metadata:
   * threads whose latest message is outbound become `awaiting`, later
   * inbound replies flip them to `replied`. Per-mailbox fan-out
   * concurrency comes from `FOLLOWUP_CHECK_CONCURRENCY` (default 8)
   * inside the worker; the outer consumer stays at 1 like every cron.
   */
  const followupCheckWorker = new FollowupCheckWorker({ db });
  followupCheckWorker.setObserver(observer);
  followupCheckWorker.setDeadLetterRecorder(deadLetterRecorder);
  const followupCheckBullWorker = new Worker<FollowupCheckJobData, FollowupCheckResult>(
    FOLLOWUP_CHECK_QUEUE,
    (job) => followupCheckWorker.run(job),
    { connection, concurrency: 1, ...cronTuning },
  );
  followupCheckBullWorker.on('error', (err) => {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'bullmq.error',
        queue: FOLLOWUP_CHECK_QUEUE,
        message: err.message,
      }),
    );
  });

  const followupCheckSchedulerQueue = new Queue<FollowupCheckJobData>(FOLLOWUP_CHECK_QUEUE, {
    connection,
  });

  async function enqueueFollowupCheck(): Promise<void> {
    if (shuttingDown) return;
    try {
      await enqueueFollowupCheckTick(followupCheckSchedulerQueue);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'followup_check.scheduler_failed',
          message: error.message,
        }),
      );
      observer.captureBackgroundFailure(error, { kind: 'followup_check.scheduler_failed' });
    }
  }

  await enqueueFollowupCheck();
  const followupCheckSchedulerHandle = setInterval(() => {
    void enqueueFollowupCheck();
  }, FOLLOWUP_CHECK_INTERVAL_MS);
  followupCheckSchedulerHandle.unref();

  console.log(
    JSON.stringify({ level: 'info', kind: 'worker.listening', queue: INITIAL_SYNC_QUEUE }),
  );
  console.log(
    JSON.stringify({ level: 'info', kind: 'worker.listening', queue: INCREMENTAL_SYNC_QUEUE }),
  );
  console.log(
    JSON.stringify({ level: 'info', kind: 'worker.listening', queue: ACTION_RECOVERY_QUEUE }),
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
  console.log(
    JSON.stringify({
      level: 'info',
      kind: 'worker.listening',
      queue: EMAIL_SEND_QUEUE,
      resendConfigured: Boolean(process.env.RESEND_API_KEY),
    }),
  );
  console.log(
    JSON.stringify({ level: 'info', kind: 'worker.listening', queue: AUTOPILOT_APPLY_QUEUE }),
  );
  console.log(
    JSON.stringify({ level: 'info', kind: 'worker.listening', queue: AUTOPILOT_ACTION_QUEUE }),
  );
  console.log(
    JSON.stringify({ level: 'info', kind: 'worker.listening', queue: SNOOZE_WAKE_QUEUE }),
  );
  console.log(
    JSON.stringify({ level: 'info', kind: 'worker.listening', queue: DEAD_LETTER_QUEUE }),
  );
  console.log(
    JSON.stringify({ level: 'info', kind: 'worker.listening', queue: DELETION_SWEEP_QUEUE }),
  );
  console.log(
    JSON.stringify({ level: 'info', kind: 'worker.listening', queue: FOLLOWUP_CHECK_QUEUE }),
  );

  /**
   * OutboxDispatcherWorker (D13, D204) — the single consumer pipeline
   * for every cross-feature event the API publishes (LabelActionWorker's
   * action.label_action_applied, ActionsService's actions.unsubscribe
   * _intent_recorded, future topics). Started here so an `outbox_events`
   * row written by any publisher lands in the senders / activity /
   * autopilot projection within seconds.
   *
   * Wake-up path:
   *   - LISTEN/NOTIFY via a dedicated pg connection (`outboxListenPg`)
   *     so the dispatcher wakes on commit instead of polling.
   *   - Polling fallback every 5s catches any missed NOTIFY (worker
   *     restart, network blip, Postgres failover).
   *
   * The consumer router (`buildOutboxConsumer`) dispatches by topic.
   * Each handler is idempotent on the event id (at-least-once delivery
   * is the dispatcher's guarantee; at-most-once is the consumer's
   * responsibility).
   */
  // prepare:false — same Supabase tx-pooler reason as `pg` above.
  const outboxListenPg = postgres(process.env.DATABASE_URL ?? '', {
    max: 1,
    prepare: false,
  });
  const outboxDispatcher = new OutboxDispatcherWorker({
    db,
    // U-WIRE (D225): full consumer deps. `autopilotApplyQueue` routes
    // sync_ready + score_run_completed into the apply sweep (U14);
    // `onMailboxSyncReady` enqueues the D6/D162 sync-complete email +
    // 24h reminder — wiring it silences the designed
    // `sync_ready_email_unwired` ERROR the router fires when absent.
    consumer: buildOutboxConsumer(db, {
      autopilotApplyQueue,
      onMailboxSyncReady: buildSyncReadyEmailHandler({
        db,
        emailQueue: emailSendQueue,
        appUrl: process.env.WEB_URL ?? 'http://localhost:3000',
      }),
    }),
    observer: {
      captureBackgroundFailure: (err, ctx) =>
        observer.captureBackgroundFailure(err instanceof Error ? err : new Error(String(err)), ctx),
    },
    listen: async (handler) => {
      // Dedicated connection for the LISTEN — the dispatcher's own
      // pg pool is shared with feature reads/writes. A LISTEN holds
      // the connection for the worker's full lifetime; we don't want
      // that to starve the pool.
      await outboxListenPg.listen(OUTBOX_NOTIFY_CHANNEL, () => handler());
      // Return the unsubscribe — the dispatcher calls this on shutdown.
      return async () => {
        await outboxListenPg.end({ timeout: 5 });
      };
    },
  });
  await outboxDispatcher.start();
  console.log(
    JSON.stringify({ level: 'info', kind: 'worker.listening', queue: 'outbox-dispatcher' }),
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
    clearInterval(undoExpirySchedulerHandle);
    clearInterval(sendersCounterReconciliationSchedulerHandle);
    clearInterval(watchRenewalSchedulerHandle);
    clearInterval(incrementalDriftHandle);
    clearInterval(snoozeWakeSchedulerHandle);
    clearInterval(deadLetterSchedulerHandle);
    clearInterval(deletionSweepSchedulerHandle);
    clearInterval(followupCheckSchedulerHandle);
    void (async () => {
      if (inFlight) {
        await inFlight;
      }
      // Await any mid-flight drift sweep so its pg.select doesn't race
      // pg.end() (silent-failure-hunter 2026-06-06).
      if (driftInFlight) {
        await driftInFlight;
      }
      // Stop the outbox dispatcher first so a draining BullMQ Worker
      // doesn't race a fresh dispatch tick that touched the same db.
      await outboxDispatcher.stop();
      await bullWorker.close();
      await incrementalBullWorker.close();
      await briefSnapshotBullWorker.close();
      await briefSchedulerQueue.close();
      await scoreBullWorker.close();
      await labelActionBullWorker.close();
      await actionRecoveryBullWorker.close();
      await unsubExecutionBullWorker.close();
      await undoExpiryBullWorker.close();
      await undoExpirySchedulerQueue.close();
      await sendersCounterReconciliationBullWorker.close();
      await sendersCounterReconciliationSchedulerQueue.close();
      await watchRenewalBullWorker.close();
      await watchRenewalSchedulerQueue.close();
      await emailSendBullWorker.close();
      await emailSendQueue.close();
      await autopilotApplyBullWorker.close();
      await autopilotActionBullWorker.close();
      await autopilotApplyQueue.close();
      await autopilotActionQueue.close();
      await unsubExecutionProducerQueue.close();
      await snoozeWakeBullWorker.close();
      await snoozeWakeSchedulerQueue.close();
      await deadLetterBullWorker.close();
      await deadLetterSchedulerQueue.close();
      await deletionSweepBullWorker.close();
      await deletionSweepSchedulerQueue.close();
      await followupCheckBullWorker.close();
      await followupCheckSchedulerQueue.close();
      await reconcilerQueue.close();
      await incrementalReconcilerQueue.close();
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

  // Cloud Run health probe: flip to 200 only after every BullMQ worker
  // is listening + the outbox dispatcher is wired. Probes before this
  // point return 503 so a half-booted revision isn't routed traffic.
  bootstrapComplete = true;
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
      // Gate Sentry in the failure path the same way bootstrap does —
      // without this, a Sentry init hang in the boot-failure recovery
      // path leaves the process stuck rather than exiting with code 1.
      if (process.env.WORKER_SENTRY_ENABLED === 'true') {
        await initSentry();
        const obs = await createSentryWorkerObserver({
          dsnSet: Boolean(process.env.SENTRY_DSN),
        });
        obs.captureBackgroundFailure(error, { kind: 'worker.boot_failed' });
      }
    } catch {
      // Capturing the boot failure must never itself crash the exit
      // path — better to lose the Sentry event than hang the process.
    } finally {
      process.exit(1);
    }
  })();
});
