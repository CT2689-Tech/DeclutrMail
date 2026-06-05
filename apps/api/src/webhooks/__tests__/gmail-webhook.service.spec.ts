import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  mailboxAccounts,
  providerSyncState,
  schema,
  users,
  webhookDedup,
  workspaces,
} from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

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
    const incrementalQueueStub = {
      getJob: async () => null,
      add: async () => undefined,
    } as unknown as Queue<IncrementalSyncJobData>;
    const sync = new SyncService(queueStub, db);
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

    // sync state advanced + history_id_updated_at set.
    const sync = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));
    expect(sync[0]!.lastHistoryId).toBe(1500n);
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

    // The second push must NOT have advanced the cursor.
    const sync = await db.select().from(providerSyncState);
    expect(sync[0]!.lastHistoryId).toBe(1500n);
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

  it('rolls back dedup row when cursor advance crashes mid-transaction (P1 atomicity)', async () => {
    // Regression for PR #113 review P1: dedup insert + historyId advance
    // MUST commit atomically. If the advance throws after the dedup row
    // is written, the dedup row MUST NOT be visible to a retry — else
    // Pub/Sub redelivery dedup-skips the work and the cursor never advances.
    const { mailboxId } = await seedMailbox(db, 'alice@example.com', 1000n);
    const queueStub = {} as Queue<InitialSyncJobData>;

    // Wire a SyncService whose `advanceHistoryIdWithExecutor` throws
    // mid-transaction. Subclass so the rest of the surface (and the
    // service's @Inject contract) stays untouched.
    class CrashingSync extends SyncService {
      override async advanceHistoryIdWithExecutor(): Promise<never> {
        throw new Error('simulated crash mid-advance');
      }
    }
    const incrementalQueueStub = {
      getJob: async () => null,
      add: async () => undefined,
    } as unknown as Queue<IncrementalSyncJobData>;
    const crashingService = new GmailWebhookService(
      db,
      new CrashingSync(queueStub, db),
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
    // section (not deduped to no-op) and successfully advances the cursor.
    const healthyService = new GmailWebhookService(
      db,
      new SyncService(queueStub, db),
      incrementalQueueStub,
    );
    const retry = await healthyService.processVerifiedPush({
      messageId: 'msg-crash',
      payload: { emailAddress: 'alice@example.com', historyId: '1500' },
    });
    expect(retry.kind).toBe('enqueued');

    // Dedup row now exists from the retry; cursor is advanced.
    const dedupAfterRetry = await db
      .select()
      .from(webhookDedup)
      .where(eq(webhookDedup.messageId, 'msg-crash'));
    expect(dedupAfterRetry.length).toBe(1);

    syncState = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));
    expect(syncState[0]!.lastHistoryId).toBe(1500n);
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

  it('returns first_advance_skipped_enqueue when previousHistoryId is null (no queue.add call)', async () => {
    // architecture-guardian 2026-06-05 [WARNING] discriminator clarity:
    // first webhook after initial-sync seeds `last_history_id` from a
    // null prior. The InitialSyncWorker already covers messages up to
    // its snapshot, so the worker would have nothing to page from a
    // null start cursor. The outcome MUST be observable as a
    // deliberate skip — NOT counted as a real enqueue.
    //
    // Seed shape: a `provider_sync_state` row EXISTS (ready) but its
    // `last_history_id` is NULL — the "initial-sync just finished but
    // never wrote a historyId snapshot" edge case (pre-D5 mailboxes
    // or InitialSyncWorker failing to capture historyId from getProfile).
    const { mailboxId } = await seedMailbox(db, 'alice@example.com', null);
    await db.insert(providerSyncState).values({
      mailboxAccountId: mailboxId,
      readinessStatus: 'ready',
      currentStage: 'ready',
      progressPct: 100,
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
    const skipService = new GmailWebhookService(db, new SyncService(queueStub, db), trackingQueue);
    const outcome = await skipService.processVerifiedPush({
      messageId: 'msg-first',
      payload: { emailAddress: 'alice@example.com', historyId: '1500' },
    });
    expect(outcome.kind).toBe('first_advance_skipped_enqueue');
    if (outcome.kind === 'first_advance_skipped_enqueue') {
      expect(outcome.mailboxAccountId).toBe(mailboxId);
      expect(outcome.historyId).toBe(1500n);
    }
    // CRITICAL: no enqueue happened.
    expect(addCalled).toBe(false);
    // Cursor still advanced durably.
    const state = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));
    expect(state[0]!.lastHistoryId).toBe(1500n);
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
      new SyncService(queueStub, db),
      observingQueue,
    );
    const outcome = await orderingService.processVerifiedPush({
      messageId: 'msg-order',
      payload: { emailAddress: 'alice@example.com', historyId: '1500' },
    });
    expect(outcome.kind).toBe('enqueued');
    // Both invariants visible at enqueue time = tx committed FIRST.
    expect(dedupVisibleAtEnqueue).toBe(true);
    expect(cursorAtEnqueue).toBe(1500n);
  });

  it('enqueue failure does NOT roll back the tx (recovery via reconciler-on-redis-state)', async () => {
    // webhook-security-auditor 2026-06-05 [WARNING] coverage gap: the
    // try/catch around `ensureIncrementalSyncJob` is load-bearing — a
    // Redis outage MUST leave the dedup row + cursor advance durable so
    // (a) Pub/Sub doesn't retry forever against a non-idempotent cursor
    // (the dedup row catches the redelivery) and (b) the future
    // reconciler can backfill the range from the durable cursor.
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
      new SyncService(queueStub, db),
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
    // Cursor advanced — the reconciler's recovery path reads this.
    const state = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));
    expect(state[0]!.lastHistoryId).toBe(1500n);
  });
});
