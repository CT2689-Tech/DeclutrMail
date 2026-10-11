#!/usr/bin/env tsx
/**
 * One manual initial-scan recovery. Dry-run unless --confirm.
 *
 *   pnpm exec tsx scripts/requeue-scan.ts --mailbox <uuid>
 *   pnpm exec tsx scripts/requeue-scan.ts --mailbox <uuid> --confirm
 */
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { providerSyncState, securityEvents } from '@declutrmail/db';
import type { IncrementalSyncJobData, InitialSyncJobData } from '@declutrmail/workers';

import type { DrizzleDb } from '../apps/api/src/db/db.module.js';
import { SyncService } from '../apps/api/src/sync/sync.service.js';
import { assertLocalOpsDsn } from './local-dsn.js';
import {
  parseRequeueArgs,
  runRequeue,
  type RequeueOutcome,
} from '../apps/api/src/sync/requeue-scan-core.js';

export async function main(argv: readonly string[]): Promise<void> {
  const args = parseRequeueArgs(argv);
  const dsn =
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/declutrmail';
  assertLocalOpsDsn(dsn, 'requeue-scan');
  const client = postgres(dsn, { max: 1 });
  const db = drizzle(client);
  const redis = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const queue = new Queue<InitialSyncJobData>('initial-sync', {
    connection: { url: redis, maxRetriesPerRequest: 1 },
  });
  const incremental = new Queue<IncrementalSyncJobData>('incremental-sync', {
    connection: { url: redis, maxRetriesPerRequest: 1 },
  });
  const sync = new SyncService(queue, incremental, db as unknown as DrizzleDb);
  try {
    const code = await runRequeue(args, {
      async load(mailboxId) {
        const rows = await db
          .select({
            mailboxId: providerSyncState.mailboxAccountId,
            errorClass: providerSyncState.errorCode,
          })
          .from(providerSyncState)
          .where(eq(providerSyncState.mailboxAccountId, mailboxId))
          .limit(1);
        return rows[0] ?? null;
      },
      async retry(mailboxId) {
        return sync.retryFailedInitialSync(mailboxId) as Promise<RequeueOutcome>;
      },
      async audit(input) {
        await db.insert(securityEvents).values({
          eventType: 'sync.manual_requeue',
          severity: 'info',
          payload: {
            mailboxId: input.mailboxId,
            errorClass: input.errorClass,
            outcome: input.outcome,
          },
        });
      },
      write(line) {
        process.stdout.write(`${line}\n`);
      },
    });
    process.exitCode = code;
  } finally {
    await queue.close();
    await incremental.close();
    await client.end();
  }
}

const invoked = process.argv[1]?.includes('requeue-scan.ts');
if (invoked) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : 'requeue-scan failed'}\n`);
    process.exitCode = 1;
  });
}
