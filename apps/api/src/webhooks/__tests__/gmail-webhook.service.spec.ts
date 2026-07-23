import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  accountDeletionRequests,
  mailboxAccounts,
  providerSyncState,
  schema,
  users,
  webhookDedup,
  workspaces,
} from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Queue } from 'bullmq';
import type { IncrementalSyncJobData, InitialSyncJobData } from '@declutrmail/workers';

import type { DrizzleDb } from '../../db/db.module.js';
import { SyncService } from '../../sync/sync.service.js';
import { GmailWebhookService } from '../gmail-webhook.service.js';

/**
 * GmailWebhookService integration tests (D8, D229 step 7 + 8).
 *
 * Runs against an in-process PGlite with every migration applied,
 * so the dedup PK + sync-state row lock + monotonic compare are
 * exercised against the real schema instead of a hand-rolled stub.
 */

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'migrations',
);

async function freshDb(): Promise<DrizzleDb> {
  const pg = new PGlite({ extensions: { citext } });
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await pg.query(trimmed);
      }
    }
  }
  // PGlite + postgres-js share Drizzle's query builder; the cast lets
  // the service (typed for the postgres-js driver) run in-test.
  return drizzle(pg, { schema }) as unknown as DrizzleDb;
}

async function seedMailbox(
  db: DrizzleDb,
  emailAddress: string,
  lastHistoryId: bigint | null = null,
): Promise<{ mailboxId: string }> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Test WS' })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: emailAddress })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: emailAddress,
    })
    .returning({ id: mailboxAccounts.id });
  if (lastHistoryId !== null) {
    await db.insert(providerSyncState).values({
      mailboxAccountId: mailbox!.id,
      lastHistoryId,
      historyIdUpdatedAt: new Date(),
      readinessStatus: 'ready',
      currentStage: 'ready',
      progressPct: 100,
    });
  }
  return { mailboxId: mailbox!.id };
}

describe('GmailWebhookService.processVerifiedPush', () => {
  let db: DrizzleDb;
  let service: GmailWebhookService;
  let incrementalQueueAdd: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    db = await freshDb();
    // SyncService's `advanceHistoryId` (D204 facade) does not touch the
    // queue, so a never-called stub is sufficient. `enqueueInitialSync`
    // / `schedule` are exercised by SyncService's own specs.
    const queueStub = {} as Queue<InitialSyncJobData>;
    // `ensureIncrementalSyncJob` is exercised by the IncrementalSyncWorker
    // spec; here we just need an object whose `getJob`/`add` shape is
    // present at call time. A bare stub with both methods returning
    // resolved promises is enough — the webhook test asserts on the
    // dedup + cursor side of `processVerifiedPush`, not the enqueue.
    incrementalQueueAdd = vi.fn().mockResolvedValue(undefined);
    const incrementalQueueStub = {
      getJob: async () => null,
      add: incrementalQueueAdd,
    } as unknown as Queue<IncrementalSyncJobData>;
    const sync = new SyncService(queueStub, incrementalQueueStub, db);
    service = new GmailWebhookService(db, sync, incrementalQueueStub);
  });

  it('advances historyId, writes a dedup row, returns enqueued', async () => {
    const { mailboxId } = await seedMailbox(db, 'alice@example.com', 1000n);

    const outcome = await service.processVerifiedPush({
      messageId: 'msg-001',
      payload: { emailAddress: 'alice@example.com', historyId: '1500' },
    });

    expect(outcome.kind).toBe('enqueued');
    if (outcome.kind === 'enqueued') {
      expect(outcome.mailboxAccountId).toBe(mailboxId);
      expect(outcome.historyId).toBe(1500n);
      expect(outcome.previousHistoryId).toBe(1000n);
    }

    // Dedup row exists + carries mailbox_account_id back-fill.
    const dedupRows = await db
      .select()
      .from(webhookDedup)
      .where(eq(webhookDedup.messageId, 'msg-001'));
    expect(dedupRows.length).toBe(1);
    expect(dedupRows[0]!.mailboxAccountId).toBe(mailboxId);
    expect(dedupRows[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // The webhook plans/enqueues from the APPLIED cursor. Only the
    // IncrementalSyncWorker advances it after the range is persisted.
    const sync = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));
    expect(sync[0]!.lastHistoryId).toBe(1000n);
    expect(sync[0]!.historyIdUpdatedAt).toBeInstanceOf(Date);
  });

  it('returns duplicate_message_id on a repeat messageId (step 7)', async () => {
    await seedMailbox(db, 'alice@example.com', 1000n);
    await service.processVerifiedPush({
      messageId: 'msg-dup',
      payload: { emailAddress: 'alice@example.com', historyId: '1500' },
    });
    const second = await service.processVerifiedPush({
      messageId: 'msg-dup',
      payload: { emailAddress: 'alice@example.com', historyId: '1600' },
    });
    expect(second.kind).toBe('duplicate_message_id');
    if (second.kind === 'duplicate_message_id') {
      expect(second.messageId).toBe('msg-dup');
    }

    // Neither webhook delivery advances the applied cursor.
    const sync = await db.select().from(providerSyncState);
    expect(sync[0]!.lastHistoryId).toBe(1000n);
  });

  it('returns stale_history_id on equal or lower incoming historyId (step 8)', async () => {
    await seedMailbox(db, 'alice@example.com', 2000n);

    const equal = await service.processVerifiedPush({
      messageId: 'msg-equal',
      payload: { emailAddress: 'alice@example.com', historyId: '2000' },
    });
    expect(equal.kind).toBe('stale_history_id');
    if (equal.kind === 'stale_history_id') {
      expect(equal.lastHistoryId).toBe(2000n);
      expect(equal.incomingHistoryId).toBe(2000n);
    }

    const lower = await service.processVerifiedPush({
      messageId: 'msg-lower',
      payload: { emailAddress: 'alice@example.com', historyId: '1500' },
    });
    expect(lower.kind).toBe('stale_history_id');

    // Cursor untouched.
    const sync = await db.select().from(providerSyncState);
    expect(sync[0]!.lastHistoryId).toBe(2000n);
  });

  it('returns unknown_mailbox when the emailAddress does not resolve', async () => {
    const outcome = await service.processVerifiedPush({
      messageId: 'msg-orphan',
      payload: { emailAddress: 'unknown@example.com', historyId: '500' },
    });
    expect(outcome.kind).toBe('unknown_mailbox');

    // Dedup row was written before the lookup — defense in depth.
    const dedup = await db.select().from(webhookDedup);
    expect(dedup.length).toBe(1);
    expect(dedup[0]!.messageId).toBe('msg-orphan');
  });

  it('treats a disconnected mailbox as unknown and does not advance or enqueue', async () => {
    const { mailboxId } = await seedMailbox(db, 'alice@example.com', 1000n);
    await db
      .update(mailboxAccounts)
      .set({ status: 'disconnected' })
      .where(eq(mailboxAccounts.id, mailboxId));

    const outcome = await service.processVerifiedPush({
      messageId: 'msg-after-disconnect',
      payload: { emailAddress: 'alice@example.com', historyId: '1500' },
    });

    expect(outcome).toEqual({
      kind: 'unknown_mailbox',
      emailAddress: 'alice@example.com',
    });
    expect(incrementalQueueAdd).not.toHaveBeenCalled();

    const [sync] = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));
    expect(sync!.lastHistoryId).toBe(1000n);

    // The dedup gate still records the Pub/Sub envelope, but an ineligible
    // mailbox is never linked to it or allowed into the sync pipeline.
    const [dedup] = await db
      .select()
      .from(webhookDedup)
      .where(eq(webhookDedup.messageId, 'msg-after-disconnect'));
    expect(dedup!.mailboxAccountId).toBeNull();
  });

  it('returns deletion_pending + does NOT advance the cursor while a D232 deletion is in flight', async () => {
    const { mailboxId } = await seedMailbox(db, 'alice@example.com', 1000n);
    const [mailbox] = await db
      .select({ userId: mailboxAccounts.userId })
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.id, mailboxId));
    await db.insert(accountDeletionRequests).values({
      userId: mailbox!.userId,
      effectiveAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      basis: 'flat-grace',
      status: 'pending',
    });

    const outcome = await service.processVerifiedPush({
      messageId: 'msg-paused',
      payload: { emailAddress: 'alice@example.com', historyId: '1500' },
    });

    expect(outcome.kind).toBe('deletion_pending');
    // Cursor untouched — advancing while paused would strand (S, H] on
    // cancel.
    const sync = await db.select().from(providerSyncState);
    expect(sync[0]!.lastHistoryId).toBe(1000n);

    // Cancel un-pauses: the NEXT push (fresh messageId) syncs again.
    await db
      .update(accountDeletionRequests)
      .set({ status: 'cancelled', cancelledAt: new Date() })
      .where(eq(accountDeletionRequests.userId, mailbox!.userId));
    const resumed = await service.processVerifiedPush({
      messageId: 'msg-resumed',
      payload: { emailAddress: 'alice@example.com', historyId: '1500' },
    });
    expect(resumed.kind).toBe('enqueued');
    const syncAfter = await db.select().from(providerSyncState);
    expect(syncAfter[0]!.lastHistoryId).toBe(1000n);
  });

  it('returns sync_state_uninitialized + does NOT create provider_sync_state when the mailbox has no row yet', async () => {
    // Webhook arrival != initial sync completed. Bootstrapping
    // `provider_sync_state` here would bypass D224's sync gate and
    // let the UI render the mailbox as "ready to triage" without any
    // real data. Bootstrap is the OAuth-connect / InitialSyncWorker
    // flow's responsibility (D109, D224).
    const { mailboxId } = await seedMailbox(db, 'bob@example.com', null);

    const outcome = await service.processVerifiedPush({
      messageId: 'msg-uninitialized',
      payload: { emailAddress: 'bob@example.com', historyId: '42' },
    });
    expect(outcome.kind).toBe('sync_state_uninitialized');
    if (outcome.kind === 'sync_state_uninitialized') {
      expect(outcome.mailboxAccountId).toBe(mailboxId);
    }

    // CRITICAL: the webhook path must NOT write a sync-state row.
    const sync = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));
    expect(sync.length).toBe(0);

    // Dedup row still written before lookup — at-least-once still safe.
    const dedup = await db
      .select()
      .from(webhookDedup)
      .where(eq(webhookDedup.messageId, 'msg-uninitialized'));
    expect(dedup.length).toBe(1);
    expect(dedup[0]!.mailboxAccountId).toBe(mailboxId);
  });

  it('rolls back dedup row when range planning crashes mid-transaction', async () => {
    // The dedup insert + applied-cursor read share one transaction. If
    // planning throws, the dedup row must not hide the retry.
    const { mailboxId } = await seedMailbox(db, 'alice@example.com', 1000n);
    const queueStub = {} as Queue<InitialSyncJobData>;

    // Wire a SyncService whose `planHistorySyncWithExecutor` throws
    // mid-transaction. Subclass so the rest of the surface (and the
    // service's @Inject contract) stays untouched.
    class CrashingSync extends SyncService {
      override async planHistorySyncWithExecutor(): Promise<never> {
        throw new Error('simulated crash mid-plan');
      }
    }
    const incrementalQueueStub = {
      getJob: async () => null,
      add: async () => undefined,
    } as unknown as Queue<IncrementalSyncJobData>;
    const crashingService = new GmailWebhookService(
      db,
      new CrashingSync(queueStub, {} as Queue<IncrementalSyncJobData>, db),
      incrementalQueueStub,
    );

    // First push crashes — the transaction must roll back.
    await expect(
      crashingService.processVerifiedPush({
        messageId: 'msg-crash',
        payload: { emailAddress: 'alice@example.com', historyId: '1500' },
      }),
    ).rejects.toThrow(/simulated crash/);

    // Dedup row is NOT visible — the tx rolled back, so the insert was undone.
    const dedupAfterCrash = await db
      .select()
      .from(webhookDedup)
      .where(eq(webhookDedup.messageId, 'msg-crash'));
    expect(dedupAfterCrash.length).toBe(0);

    // Cursor was NOT advanced.
    let syncState = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));
    expect(syncState[0]!.lastHistoryId).toBe(1000n);

    // A Pub/Sub retry with the SAME messageId re-enters the critical
    // section (not deduped to no-op) and successfully enqueues the range.
    const healthyService = new GmailWebhookService(
      db,
      new SyncService(queueStub, incrementalQueueStub, db),
      incrementalQueueStub,
    );
    const retry = await healthyService.processVerifiedPush({
      messageId: 'msg-crash',
      payload: { emailAddress: 'alice@example.com', historyId: '1500' },
    });
    expect(retry.kind).toBe('enqueued');

    // Dedup row now exists from the retry; applied cursor stays put.
    const dedupAfterRetry = await db
      .select()
      .from(webhookDedup)
      .where(eq(webhookDedup.messageId, 'msg-crash'));
    expect(dedupAfterRetry.length).toBe(1);

    syncState = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));
    expect(syncState[0]!.lastHistoryId).toBe(1000n);
  });

  it('rejects an oversized messageId at the DB length cap (varchar 512)', async () => {
    // Pub/Sub messageIds are ~16 chars in practice. The schema caps
    // the column at varchar(512) so a pathological publisher (or a
    // hostile mirror) cannot inflate the PK index with multi-KB rows.
    await seedMailbox(db, 'alice@example.com', 1000n);
    const oversized = 'x'.repeat(513);

    // Drizzle 0.43+ wraps Postgres errors in a `DrizzleQueryError` whose
    // top-level `.message` is just "Failed query: <SQL>". The real
    // string-truncation message ("value too long for type character
    // varying(512)") lives on `.cause`. Walk the chain so the assertion
    // still pins the schema invariant rather than the wrapper format.
    const err = await service
      .processVerifiedPush({
        messageId: oversized,
        payload: { emailAddress: 'alice@example.com', historyId: '1500' },
      })
      .then(
        () => null,
        (e: unknown) => e as Error & { cause?: { message?: string; code?: string } },
      );
    expect(err).not.toBeNull();
    const messages = [err?.message, err?.cause?.message].filter(Boolean).join(' | ');
    expect(messages).toMatch(/value too long|length|varying\(512\)/i);
  });

  it('returns deferred_initial_sync_in_flight when last_history_id IS NULL — cursor NOT advanced, no enqueue', async () => {
    // D38 webhook-vs-InitialSync race fix (2026-06-09): a webhook
    // arriving while InitialSync is mid-flight (row exists with
    // `last_history_id IS NULL`, created by `markQueued`) MUST NOT
    // advance the cursor. Doing so would orphan InitialSync's snapshot
    // S, because `markReady`'s `GREATEST(stored=H, snapshot=S)` would
    // keep H>S and never write S — leaving (S, H] never paged via
    // `history.list`.
    //
    // Seed shape: a `provider_sync_state` row EXISTS (syncing) with
    // `last_history_id` NULL — the realistic mid-InitialSync state.
    const { mailboxId } = await seedMailbox(db, 'alice@example.com', null);
    await db.insert(providerSyncState).values({
      mailboxAccountId: mailboxId,
      readinessStatus: 'syncing',
      currentStage: 'fetching_metadata',
      progressPct: 5,
      lastHistoryId: null,
    });
    const queueStub = {} as Queue<InitialSyncJobData>;
    let addCalled = false;
    const trackingQueue = {
      getJob: async () => null,
      add: async () => {
        addCalled = true;
        return undefined;
      },
    } as unknown as Queue<IncrementalSyncJobData>;
    const skipService = new GmailWebhookService(
      db,
      new SyncService(queueStub, {} as Queue<IncrementalSyncJobData>, db),
      trackingQueue,
    );
    const outcome = await skipService.processVerifiedPush({
      messageId: 'msg-first',
      payload: { emailAddress: 'alice@example.com', historyId: '1500' },
    });
    expect(outcome.kind).toBe('deferred_initial_sync_in_flight');
    if (outcome.kind === 'deferred_initial_sync_in_flight') {
      expect(outcome.mailboxAccountId).toBe(mailboxId);
      expect(outcome.incomingHistoryId).toBe(1500n);
    }
    // CRITICAL: no enqueue happened.
    expect(addCalled).toBe(false);
    // CRITICAL: cursor was NOT advanced — stays NULL so InitialSync's
    // later `markReady` writes its snapshot unimpeded.
    const state = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));
    expect(state[0]!.lastHistoryId).toBeNull();
  });

  it('defers while initial sync is active after its retry snapshot is stored', async () => {
    const { mailboxId } = await seedMailbox(db, 'retrying@example.com', 1000n);
    await db
      .update(providerSyncState)
      .set({ readinessStatus: 'syncing', currentStage: 'fetching_metadata' })
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));

    const outcome = await service.processVerifiedPush({
      messageId: 'msg-retry-snapshot',
      payload: { emailAddress: 'retrying@example.com', historyId: '1500' },
    });

    expect(outcome.kind).toBe('deferred_initial_sync_in_flight');
    expect(incrementalQueueAdd).not.toHaveBeenCalled();
    const [state] = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));
    expect(state!.lastHistoryId).toBe(1000n);
  });

  it('preserves the [snapshot, webhook] range when webhook races InitialSync (D38)', async () => {
    // D38 race regression: this test exercises the actual race sequence
    // from the finding rather than just the discriminator branch.
    //
    //   T1: markQueued writes last_history_id=NULL.
    //   T2: InitialSync snapshots S (in memory; not yet in DB).
    //   T3: Mail arrives; webhook fires with H>S, hits processVerifiedPush.
    //   T4: InitialSync's markReady writes S via GREATEST(stored, S).
    //   T5: Next webhook arrives with H'>H, should enqueue from S.
    //
    // Before the fix: T3 advanced cursor NULL→H, T4's GREATEST(H, S)=H
    // kept H, and T5 enqueued from H, stranding (S, H].
    //
    // After the fix: T3 returns 'deferred' WITHOUT advancing; T4
    // writes S unimpeded; T5 enqueues from S, covering (S, H'].
    const { mailboxId } = await seedMailbox(db, 'racer@example.com', null);
    // T1: markQueued (mid-InitialSync).
    await db.insert(providerSyncState).values({
      mailboxAccountId: mailboxId,
      readinessStatus: 'syncing',
      currentStage: 'fetching_metadata',
      progressPct: 5,
      lastHistoryId: null,
    });
    // T2: snapshot S (just a variable here — InitialSync wouldn't have
    // written it to PSS yet at this point in real life).
    const snapshotS = 1000n;
    const webhookH = 1500n;
    const laterWebhookHPrime = 1700n;

    const queueStub = {} as Queue<InitialSyncJobData>;
    const enqueuedJobs: IncrementalSyncJobData[] = [];
    const recordingQueue = {
      getJob: async () => null,
      add: async (_name: string, data: IncrementalSyncJobData) => {
        enqueuedJobs.push(data);
        return undefined;
      },
    } as unknown as Queue<IncrementalSyncJobData>;
    const raceService = new GmailWebhookService(
      db,
      new SyncService(queueStub, {} as Queue<IncrementalSyncJobData>, db),
      recordingQueue,
    );

    // T3: webhook arrives mid-InitialSync — must be deferred.
    const t3 = await raceService.processVerifiedPush({
      messageId: 'msg-race-t3',
      payload: { emailAddress: 'racer@example.com', historyId: webhookH.toString() },
    });
    expect(t3.kind).toBe('deferred_initial_sync_in_flight');
    expect(enqueuedJobs.length).toBe(0);

    // Cursor must still be NULL after T3 — the whole point of the fix.
    let state = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));
    expect(state[0]!.lastHistoryId).toBeNull();

    // T4: simulate InitialSync.markReady writing snapshot S via
    // GREATEST(stored=NULL, S)=S.
    await db
      .update(providerSyncState)
      .set({
        readinessStatus: 'ready',
        currentStage: 'ready',
        progressPct: 100,
        lastHistoryId: snapshotS,
        historyIdUpdatedAt: new Date(),
      })
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));

    // T5: next webhook arrives — must enqueue from S, covering (S, H']
    // which subsumes the (S, H] range from T3.
    const t5 = await raceService.processVerifiedPush({
      messageId: 'msg-race-t5',
      payload: { emailAddress: 'racer@example.com', historyId: laterWebhookHPrime.toString() },
    });
    expect(t5.kind).toBe('enqueued');
    if (t5.kind === 'enqueued') {
      expect(t5.previousHistoryId).toBe(snapshotS);
      expect(t5.historyId).toBe(laterWebhookHPrime);
    }
    // Job was enqueued with startHistoryId=S (string of snapshotS) —
    // the (S, H] range stranded by the original bug is now covered.
    expect(enqueuedJobs.length).toBe(1);
    expect(enqueuedJobs[0]!.startHistoryId).toBe(snapshotS.toString());
    expect(enqueuedJobs[0]!.endHistoryId).toBe(laterWebhookHPrime.toString());

    // Applied cursor stays at S until IncrementalSyncWorker persists the
    // complete range and advances it to Gmail's reported historyId.
    state = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));
    expect(state[0]!.lastHistoryId).toBe(snapshotS);
  });

  it('enqueue happens AFTER the tx commits — observable ordering', async () => {
    // architecture-guardian 2026-06-05 [BLOCKING] fix: the BullMQ enqueue
    // MUST run outside the PG transaction. If it ran inside, a commit
    // failure after a successful `queue.add` would leave a durable job
    // in Redis that points at a rolled-back cursor (silent regression).
    //
    // Asserts the observable ordering: when the enqueue stub is called,
    // the dedup row + cursor advance are already visible in the DB —
    // i.e. the tx has committed before `queue.add` is invoked.
    const { mailboxId } = await seedMailbox(db, 'alice@example.com', 1000n);
    const queueStub = {} as Queue<InitialSyncJobData>;
    let dedupVisibleAtEnqueue = false;
    let cursorAtEnqueue: bigint | null = null;
    const observingQueue = {
      getJob: async () => null,
      add: async () => {
        const dedup = await db
          .select()
          .from(webhookDedup)
          .where(eq(webhookDedup.messageId, 'msg-order'));
        dedupVisibleAtEnqueue = dedup.length === 1;
        const state = await db
          .select()
          .from(providerSyncState)
          .where(eq(providerSyncState.mailboxAccountId, mailboxId));
        cursorAtEnqueue = state[0]?.lastHistoryId ?? null;
        return undefined;
      },
    } as unknown as Queue<IncrementalSyncJobData>;
    const orderingService = new GmailWebhookService(
      db,
      new SyncService(queueStub, {} as Queue<IncrementalSyncJobData>, db),
      observingQueue,
    );
    const outcome = await orderingService.processVerifiedPush({
      messageId: 'msg-order',
      payload: { emailAddress: 'alice@example.com', historyId: '1500' },
    });
    expect(outcome.kind).toBe('enqueued');
    // Dedup is committed before enqueue; applied cursor still identifies
    // the complete range the worker must process.
    expect(dedupVisibleAtEnqueue).toBe(true);
    expect(cursorAtEnqueue).toBe(1000n);
  });

  it('enqueue failure keeps the applied cursor unchanged for drift recovery', async () => {
    const { mailboxId } = await seedMailbox(db, 'alice@example.com', 1000n);
    const queueStub = {} as Queue<InitialSyncJobData>;
    const failingQueue = {
      getJob: async () => null,
      add: async () => {
        throw new Error('simulated redis down');
      },
    } as unknown as Queue<IncrementalSyncJobData>;
    const failingService = new GmailWebhookService(
      db,
      new SyncService(queueStub, {} as Queue<IncrementalSyncJobData>, db),
      failingQueue,
    );
    const outcome = await failingService.processVerifiedPush({
      messageId: 'msg-redis-down',
      payload: { emailAddress: 'alice@example.com', historyId: '1500' },
    });
    // Webhook contract: 200 to Pub/Sub regardless of Redis health.
    expect(outcome.kind).toBe('enqueued');
    // Dedup row durable — Pub/Sub redelivery will skip via step 7.
    const dedup = await db
      .select()
      .from(webhookDedup)
      .where(eq(webhookDedup.messageId, 'msg-redis-down'));
    expect(dedup.length).toBe(1);
    // Cursor unchanged — the drift sweep starts from 1000 and therefore
    // still covers the complete (1000, 1500] interval.
    const state = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));
    expect(state[0]!.lastHistoryId).toBe(1000n);
  });
});
