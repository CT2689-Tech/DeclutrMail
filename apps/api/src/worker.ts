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
      return new GmailClientService(oauth);
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
