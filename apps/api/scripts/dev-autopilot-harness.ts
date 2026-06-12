/**
 * apps/api/scripts/dev-autopilot-harness.ts — LOCAL SMOKE harness (U14).
 *
 * Runs the Autopilot execution consumer chain WITHOUT touching
 * `apps/api/src/worker.ts` (integration-owned this wave):
 *
 *   outbox dispatcher (LISTEN/NOTIFY + poll)
 *     → buildOutboxConsumer(db, { autopilotApplyQueue })
 *       · mailbox.sync_ready          → seed presets + enqueue apply
 *       · triage.score_run_completed  → enqueue apply
 *   score consumer        (ScoreWorker, outbox wired → publishes
 *                          score_run_completed)
 *   autopilot-apply consumer (AutopilotApplyWorker, onActiveMatchesPending
 *                          → enqueue autopilot-action)
 *   autopilot-action consumer (AutopilotActionWorker — REAL Gmail
 *                          mutations through the terminal-tx pipeline)
 *
 * The unsub-execution consumer is deliberately NOT started — smoke must
 * never POST a real third-party unsubscribe; the enqueue (job row +
 * BullMQ job) is the verified boundary.
 *
 * Subcommands:
 *   (default)                      run all consumers until Ctrl-C
 *   enqueue-score <mailboxId>      add one all-senders score sweep job
 *   enqueue-action <mailboxId>     add one autopilot-action sweep job
 *
 * Usage (repo root; redis db 10 per the U14 smoke spec):
 *   REDIS_URL=redis://localhost:6379/10 pnpm --filter @declutrmail/api dev:autopilot-harness
 *   REDIS_URL=redis://localhost:6379/10 pnpm --filter @declutrmail/api dev:autopilot-harness enqueue-score <mailboxId>
 *
 * This file is dev tooling only — never deployed; the production
 * registration lives in worker.ts (snippet in the U14 PR body).
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { Queue, Worker } from 'bullmq';
import { OAuth2Client } from 'google-auth-library';

import { mailboxAccounts, schema } from '@declutrmail/db';
import {
  AUTOPILOT_ACTION_JOB,
  AUTOPILOT_ACTION_QUEUE,
  AUTOPILOT_APPLY_QUEUE,
  autopilotActionJobOptions,
  createAutopilotExecutionChain,
  createRedisConnection,
  InvalidGrantError,
  LABEL_ACTION_QUEUE,
  LabelActionWorker,
  OutboxDispatcherWorker,
  OUTBOX_NOTIFY_CHANNEL,
  OutboxPublisher,
  RateLimiter,
  SCORE_JOB,
  SCORE_QUEUE,
  ScoreWorker,
  UNSUB_EXECUTION_JOB,
  UNSUB_EXECUTION_QUEUE,
  unsubExecutionJobOptions,
  ValidationError,
} from '@declutrmail/workers';
import type {
  AutopilotActionJobData,
  AutopilotApplyJobData,
  GmailMutationAccess,
  LabelActionJobData,
  MailboxActionLock,
  ScoreJobData,
  UnsubExecutionJobData,
} from '@declutrmail/workers';

import { createKmsProvider } from '../src/adapters/gcp-kms/kms-provider.factory.js';
import { TokenCryptoService } from '../src/auth/token-crypto.service.js';
import { GmailClientService } from '../src/gmail/gmail-client.service.js';
import { buildOutboxConsumer } from '../src/outbox/outbox-consumer-router.js';

const GMAIL_QUOTA_UNITS_PER_MIN = 12_000;
const GMAIL_QUOTA_WINDOW_MS = 60_000;
const LABEL_ACTION_LOCK_NS = 0x4c41; // 'LA' — MUST match worker.ts namespace

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

function log(kind: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: 'info', kind: `harness.${kind}`, ...extra }));
}

async function main(): Promise<void> {
  const [cmd, mailboxArg] = process.argv.slice(2);
  const redisUrl = requireEnv('REDIS_URL');
  const connection = createRedisConnection(redisUrl);

  if (cmd === 'enqueue-score' || cmd === 'enqueue-action') {
    if (!mailboxArg) throw new Error(`${cmd} requires a mailboxAccountId argument`);
    const producedAtMs = Date.now();
    if (cmd === 'enqueue-score') {
      const q = new Queue<ScoreJobData>(SCORE_QUEUE, { connection });
      await q.add(
        SCORE_JOB,
        { mailboxAccountId: mailboxArg, trigger: 'manual_rescore', producedAtMs },
        // `-` separator — BullMQ rejects custom jobIds containing ':'.
        { jobId: `${mailboxArg}-star-${producedAtMs}` },
      );
      log('score_enqueued', { mailboxAccountId: mailboxArg, producedAtMs });
      await q.close();
    } else {
      const q = new Queue<AutopilotActionJobData>(AUTOPILOT_ACTION_QUEUE, { connection });
      await q.add(
        AUTOPILOT_ACTION_JOB,
        { mailboxAccountId: mailboxArg, triggeredAtMs: producedAtMs },
        autopilotActionJobOptions(`${mailboxArg}-${producedAtMs}`),
      );
      log('action_enqueued', { mailboxAccountId: mailboxArg, triggeredAtMs: producedAtMs });
      await q.close();
    }
    process.exit(0);
  }

  const pg = postgres(requireEnv('DATABASE_URL'), { prepare: false });
  const db = drizzle(pg, { schema });
  const lockPg = postgres(requireEnv('DATABASE_URL'), { max: 4, prepare: false });
  const outboxListenPg = postgres(requireEnv('DATABASE_URL'), { max: 1, prepare: false });

  // Token decrypt path — same seam as worker.ts (TokenCryptoService +
  // KMS provider). Access errors log; the harness has no audit table
  // duty.
  const tokenCrypto = new TokenCryptoService(
    createKmsProvider(process.env, {
      onAccessError: ({ operation, reason }) => log('kms_access_error', { operation, reason }),
    }),
  );
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');
  const limiterByMailbox = new Map<string, RateLimiter>();

  const getGmailClient = async (mailboxAccountId: string): Promise<GmailClientService> => {
    const [account] = await db
      .select()
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.id, mailboxAccountId))
      .limit(1);
    if (!account) throw new ValidationError(`mailbox account ${mailboxAccountId} not found`);
    if (!account.encryptedRefreshToken || !account.dekEncrypted) {
      throw new InvalidGrantError(`mailbox account ${mailboxAccountId} has no stored OAuth token`);
    }
    const refreshToken = await tokenCrypto.decrypt(
      account.encryptedRefreshToken,
      account.dekEncrypted,
    );
    const oauth = new OAuth2Client(clientId, clientSecret);
    oauth.setCredentials({ refresh_token: refreshToken });
    let limiter = limiterByMailbox.get(mailboxAccountId);
    if (!limiter) {
      limiter = new RateLimiter(GMAIL_QUOTA_UNITS_PER_MIN, GMAIL_QUOTA_WINDOW_MS);
      limiterByMailbox.set(mailboxAccountId, limiter);
    }
    return new GmailClientService(oauth, limiter, ({ reason }) =>
      log('oauth_refresh_failed', { reason, mailboxAccountId }),
    );
  };
  const gmailMutationAccess: GmailMutationAccess = { getClient: getGmailClient };

  // Per-mailbox advisory lock — same two-key form + namespace as
  // worker.ts so harness actions serialize against any other process.
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
          log('advisory_unlock_failed', { mailboxAccountId });
        }
        reserved.release();
      }
    },
  };

  const outbox = new OutboxPublisher();

  // Producers.
  const applyQueue = new Queue<AutopilotApplyJobData>(AUTOPILOT_APPLY_QUEUE, { connection });
  const actionQueue = new Queue<AutopilotActionJobData>(AUTOPILOT_ACTION_QUEUE, { connection });
  const unsubQueue = new Queue<UnsubExecutionJobData>(UNSUB_EXECUTION_QUEUE, { connection });

  // Score consumer — publishes triage.score_run_completed (U14).
  const scoreWorker = new ScoreWorker({ db, outbox });
  const scoreBull = new Worker<ScoreJobData>(SCORE_QUEUE, (job) => scoreWorker.run(job), {
    connection,
    concurrency: 2,
  });
  scoreBull.on('error', (err) => log('score_bull_error', { message: err.message }));

  // Apply + action consumers via the SAME registration fn the
  // integration PR calls from worker.ts (`createAutopilotExecutionChain`
  // wires the apply→action chaining + canonical jobIds) — the smoke
  // exercises the production wiring, not a harness-local variant.
  const { applyWorker, actionWorker } = createAutopilotExecutionChain({
    db,
    gmailMutation: gmailMutationAccess,
    outbox,
    lock: mailboxLock,
    actionQueue,
    enqueueUnsubExecution: async (data) => {
      await unsubQueue.add(
        UNSUB_EXECUTION_JOB,
        data,
        unsubExecutionJobOptions(data.idempotencyKey),
      );
      log('unsub_execution_enqueued', { actionId: data.actionId });
    },
  });
  const applyBull = new Worker<AutopilotApplyJobData>(
    AUTOPILOT_APPLY_QUEUE,
    (job) => applyWorker.run(job),
    { connection, concurrency: 2 },
  );
  applyBull.on('error', (err) => log('apply_bull_error', { message: err.message }));

  const actionBull = new Worker<AutopilotActionJobData>(
    AUTOPILOT_ACTION_QUEUE,
    (job) => actionWorker.run(job),
    { connection, concurrency: 2 },
  );
  actionBull.on('error', (err) => log('action_bull_error', { message: err.message }));

  // Label-action consumer (U12-owned worker, instantiated here only so
  // the smoke can run the REVERSE/undo path against autopilot-issued
  // tokens — the existing revert machinery enqueues label-action jobs).
  const labelWorker = new LabelActionWorker({
    db,
    gmailMutation: gmailMutationAccess,
    outbox,
    lock: mailboxLock,
  });
  const labelBull = new Worker<LabelActionJobData>(
    LABEL_ACTION_QUEUE,
    (job) => labelWorker.run(job),
    { connection, concurrency: 2 },
  );
  labelBull.on('error', (err) => log('label_bull_error', { message: err.message }));

  // Outbox dispatcher — routes sync_ready + score_run_completed into
  // the apply queue (plus all the existing projections).
  const dispatcher = new OutboxDispatcherWorker({
    db,
    consumer: buildOutboxConsumer(db, { autopilotApplyQueue: applyQueue }),
    observer: {
      captureBackgroundFailure: (err) =>
        log('dispatcher_failure', { message: err instanceof Error ? err.message : String(err) }),
    },
    listen: async (handler) => {
      await outboxListenPg.listen(OUTBOX_NOTIFY_CHANNEL, () => handler());
      return async () => {
        await outboxListenPg.end({ timeout: 5 });
      };
    },
  });
  await dispatcher.start();

  log('listening', {
    queues: [SCORE_QUEUE, AUTOPILOT_APPLY_QUEUE, AUTOPILOT_ACTION_QUEUE, 'outbox-dispatcher'],
    redisUrl,
  });

  const shutdown = (): void => {
    void (async () => {
      await dispatcher.stop();
      await Promise.all([scoreBull.close(), applyBull.close(), actionBull.close()]);
      await Promise.all([applyQueue.close(), actionQueue.close(), unsubQueue.close()]);
      await connection.quit();
      await pg.end({ timeout: 5 });
      await lockPg.end({ timeout: 5 });
      process.exit(0);
    })().catch((err) => {
      console.error(String(err));
      process.exit(1);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
