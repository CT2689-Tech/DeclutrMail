import 'reflect-metadata';

import { Worker } from 'bullmq';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { OAuth2Client } from 'google-auth-library';
import postgres from 'postgres';
import { mailboxAccounts, schema } from '@declutrmail/db';
import {
  createRedisConnection,
  INITIAL_SYNC_QUEUE,
  InitialSyncWorker,
  InvalidGrantError,
  RateLimiter,
  ValidationError,
} from '@declutrmail/workers';
import type { GmailAccess, InitialSyncJobData, InitialSyncResult } from '@declutrmail/workers';

import { createKmsProvider } from './adapters/gcp-kms/kms-provider.factory.js';
import { TokenCryptoService } from './auth/token-crypto.service.js';
import { GmailClientService } from './gmail/gmail-client.service.js';

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
  const pg = postgres(requireEnv('DATABASE_URL'));
  const db = drizzle(pg, { schema });
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
  const gmailAccess: GmailAccess = {
    async getClient(mailboxAccountId) {
      const [account] = await db
        .select()
        .from(mailboxAccounts)
        .where(eq(mailboxAccounts.id, mailboxAccountId))
        .limit(1);
      if (!account) {
        throw new ValidationError(`mailbox account ${mailboxAccountId} not found`);
      }
      if (!account.encryptedRefreshToken || !account.dekEncrypted) {
        throw new InvalidGrantError(
          `mailbox account ${mailboxAccountId} has no stored OAuth token`,
        );
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
    },
  };

  const initialSync = new InitialSyncWorker({ db, gmailAccess });
  const connection = createRedisConnection(requireEnv('REDIS_URL'));

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

  console.log(
    JSON.stringify({ level: 'info', kind: 'worker.listening', queue: INITIAL_SYNC_QUEUE }),
  );

  // Graceful shutdown — drain in-flight jobs, then release connections.
  const shutdown = (signal: string): void => {
    console.log(JSON.stringify({ level: 'info', kind: 'worker.shutdown', signal }));
    void (async () => {
      await bullWorker.close();
      await connection.quit();
      await pg.end();
      process.exit(0);
    })();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void bootstrap();
