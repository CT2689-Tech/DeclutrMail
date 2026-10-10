/** Synthetic E2E driver: real PostgreSQL, Redis queues and worker lifecycle; Gmail is scripted. */
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { mailboxAccounts, mailMessages, providerSyncState, schema } from '@declutrmail/db';
import {
  InitialSyncWorker,
  IncrementalSyncWorker,
  INITIAL_SYNC_QUEUE,
  INCREMENTAL_SYNC_QUEUE,
  ensureInitialSyncJob,
  recoverExpiredHistoryCursor,
  OutboxPublisher,
  TransientError,
  type GmailMetadataClient,
  type InitialSyncJobData,
  type IncrementalSyncJobData,
} from '@declutrmail/workers';
import { SyncService } from '../sync.service.js';
import { reconcileInitialSyncs } from '../initial-sync-reconciler.js';
import { assertIsolatedEnvironment } from '../../../../../packages/e2e/helpers/isolation.js';

assertIsolatedEnvironment(process.env);
const id = 'e2eb1111-0000-4000-8000-000000000003';
const mode = process.argv[2];
const client = postgres(process.env.DATABASE_URL!, { max: 2 });
const db = drizzle(client, { schema });
const redis = new URL(process.env.REDIS_URL!);
const connection = { host: redis.hostname, port: Number(redis.port), db: 12 };
const initial = new Queue<InitialSyncJobData>(INITIAL_SYNC_QUEUE, { connection });
const incremental = new Queue<IncrementalSyncJobData>(INCREMENTAL_SYNC_QUEUE, { connection });
const events = new QueueEvents(INITIAL_SYNC_QUEUE, { connection });
const incrementalEvents = new QueueEvents(INCREMENTAL_SYNC_QUEUE, { connection });
const service = new SyncService(initial, incremental, db);
let consumer: Worker | undefined;
let gets = 0;
let lists = 0;
let histories = 0;
const profile = mode === 'fail' ? '1000' : mode === 'expired' ? '3000' : '2000';
const count = mode === 'fail' ? 10 : 11;
const metadata = (messageId: string) => ({
  id: messageId,
  threadId: messageId,
  labelIds: ['INBOX'],
  snippet: 'Synthetic recovery fixture',
  internalDate: String(Date.UTC(2026, 9, 1)),
  from: 'Recovery sender <recovery@synthetic.test>',
  subject: 'Synthetic scan',
  to: null,
  cc: null,
  listUnsubscribe: null,
  listUnsubscribePost: null,
});
const gmail: GmailMetadataClient = {
  async getProfile() {
    return { historyId: profile };
  },
  async listMessageIds() {
    lists++;
    return { ids: Array.from({ length: count }, (_, i) => `scan-probe-${i}`) };
  },
  async getMessageMetadata(messageId) {
    gets++;
    return metadata(messageId);
  },
  async listLabels() {
    if (mode === 'fail') throw new TransientError('Synthetic provider outage after saved metadata');
    return [];
  },
  async listHistory(startHistoryId) {
    histories++;
    assert.equal(startHistoryId, '1000');
    return mode === 'expired'
      ? null
      : {
          historyId: '2000',
          records: [
            {
              kind: 'added',
              messageId: 'scan-catchup',
              threadId: 'scan-catchup',
              labelIds: ['INBOX'],
            },
          ],
        };
  },
};
const state = async () =>
  (await db.select().from(providerSyncState).where(eq(providerSyncState.mailboxAccountId, id)))[0]!;
try {
  const [account] = await db.select().from(mailboxAccounts).where(eq(mailboxAccounts.id, id));
  assert.equal(account?.providerAccountId, 'chintan.e2e.billing@synthetic.test');
  await events.waitUntilReady();
  await incrementalEvents.waitUntilReady();
  if (mode === 'fail') {
    await initial.obliterate({ force: true });
    await incremental.obliterate({ force: true });
    await db
      .delete(mailMessages)
      .where(
        sql`${mailMessages.mailboxAccountId} = ${id} AND ${mailMessages.providerMessageId} LIKE 'scan-%'`,
      );
    await db
      .update(providerSyncState)
      .set({
        readinessStatus: 'queued',
        currentStage: 'queued',
        progressPct: 0,
        lastHistoryId: null,
        lastSyncedAt: null,
        initialRetryAt: null,
        initialRecoveryAttempts: 0,
      })
      .where(eq(providerSyncState.mailboxAccountId, id));
    const worker = new InitialSyncWorker({
      db,
      gmailAccess: { getClient: async () => gmail },
      outbox: new OutboxPublisher(),
    });
    consumer = new Worker(INITIAL_SYNC_QUEUE, (job) => worker.run(job), { connection });
    const job = await initial.add(
      INITIAL_SYNC_QUEUE,
      { mailboxAccountId: id },
      { jobId: id, attempts: 5, backoff: { type: 'fixed', delay: 1 } },
    );
    await assert.rejects(job.waitUntilFinished(events, 30_000), /Synthetic provider outage/);
    assert.equal((await state()).readinessStatus, 'failed');
    assert.equal((await state()).lastHistoryId, 1000n);
    assert.equal(gets, 10); // Ordinary retries already reuse all saved messages.
    assert.ok((await state()).initialRetryAt);
  } else if (mode === 'resume') {
    const before = await state();
    assert.equal(before.readinessStatus, 'failed');
    assert.ok(before.initialRetryAt);
    const worker = new InitialSyncWorker({
      db,
      gmailAccess: { getClient: async () => gmail },
      outbox: new OutboxPublisher(),
    });
    consumer = new Worker(INITIAL_SYNC_QUEUE, (job) => worker.run(job), { connection });
    await reconcileInitialSyncs({
      db,
      schedule: (mailboxId) => ensureInitialSyncJob(initial, mailboxId),
      isShuttingDown: () => false,
      now: () => new Date(before.initialRetryAt!.getTime() + 1),
    });
    const job = await initial.getJob(id);
    assert.ok(job);
    await job.waitUntilFinished(events, 30_000);
    assert.equal(gets, 1); // Ten saved messages are skipped; only the new message is fetched.
    assert.equal((await state()).lastHistoryId, 1000n);
    assert.equal((await state()).readinessStatus, 'ready');
    assert.equal((await state()).initialRetryAt, null);
  } else if (mode === 'reconnect' || mode === 'expired') {
    // Script the OAuth exchange boundary: disconnect retains indexed data;
    // fresh credentials reactivate the same mailbox inside the connect transaction.
    await db
      .update(mailboxAccounts)
      .set({ status: 'disconnected' })
      .where(eq(mailboxAccounts.id, id));
    const outcome = await db.transaction(async (tx) => {
      await tx.update(mailboxAccounts).set({ status: 'active' }).where(eq(mailboxAccounts.id, id));
      return service.markConnected(tx, id, { wasActive: false });
    });
    assert.equal(outcome, 'kept_ready');
    assert.equal((await state()).lastHistoryId, 1000n);
    const worker = new IncrementalSyncWorker({
      db,
      gmailAccess: { getClient: async () => gmail },
      lock: { run: async (_, fn) => fn() },
    });
    consumer = new Worker(INCREMENTAL_SYNC_QUEUE, (job) => worker.run(job), { connection });
    await service.scheduleCatchUp(id);
    const jobs = await incremental.getJobs(['waiting', 'active', 'completed']);
    const job = jobs.find((j) => j.data.mailboxAccountId === id);
    assert.ok(job);
    const result = await job.waitUntilFinished(incrementalEvents, 30_000);
    assert.equal(lists, 0); // Reconnect never starts InitialSync.
    assert.ok(histories > 0);
    if (mode === 'reconnect') {
      assert.equal((await state()).lastHistoryId, 2000n);
      assert.equal((await state()).readinessStatus, 'ready');
      assert.equal(gets, 1);
    } else {
      assert.equal(result.cursorTooOld, true);
      await consumer.close();
      const initialWorker = new InitialSyncWorker({
        db,
        gmailAccess: { getClient: async () => gmail },
        outbox: new OutboxPublisher(),
      });
      consumer = new Worker(INITIAL_SYNC_QUEUE, (job) => initialWorker.run(job), { connection });
      await recoverExpiredHistoryCursor(db, initial, id, '1000');
      const resync = await initial.getJob(id);
      assert.ok(resync);
      await resync.waitUntilFinished(events, 30_000);
      assert.equal((await state()).lastHistoryId, 3000n);
      assert.equal((await state()).readinessStatus, 'ready');
    }
  } else throw new Error('Expected fail, resume, reconnect or expired');
  const [saved] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mailMessages)
    .where(eq(mailMessages.mailboxAccountId, id));
  console.log(
    JSON.stringify({
      mode,
      metadataGets: gets,
      fullLists: lists,
      historyCalls: histories,
      savedMessages: saved!.count,
      readiness: (await state()).readinessStatus,
      cursor: (await state()).lastHistoryId?.toString(),
    }),
  );
} finally {
  await consumer?.close();
  await Promise.all([
    initial.close(),
    incremental.close(),
    events.close(),
    incrementalEvents.close(),
  ]);
  await client.end();
}
