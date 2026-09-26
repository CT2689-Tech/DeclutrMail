import {
  actionJobs,
  actionRecoveryPreviews,
  activityLog,
  mailMessages,
  mailboxAccounts,
  outboxEvents,
  schema,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import {
  LABEL_SENDER_PROTECTED_ERROR_CODE,
  LabelActionWorker,
  OutboxPublisher,
  PASSTHROUGH_MAILBOX_LOCK,
  RECOVERY_SENDER_PROTECTED_ERROR_CODE,
  type BatchModifyOptions,
  type GmailMutationAccess,
  type GmailMutationClient,
  type LabelActionJobData,
  type WorkerContext,
} from '@declutrmail/workers';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { SendersPolicyService } from '../senders/senders-policy.service.js';
import { ActionRecoveryService } from './action-recovery.service.js';
import { ActionsService } from './actions.service.js';

/**
 * Preview ↔ execution contract across the WHOLE pipeline (D226 —
 * 2026-07-26 finding 5.5). Real ActionsService + real LabelActionWorker
 * against ONE PGlite: the number the preview showed must be the number
 * enqueue stamps (`requestedCount`), the worker resolves, and the
 * receipt (`affectedCount` + activity row) reports — including the
 * inbound-only rule that keeps self-sent SENT+INBOX mail untouched.
 */

type Db = ReturnType<typeof drizzle<typeof schema>>;

const SENDER_KEY = 'd'.repeat(64);

async function freshDb(): Promise<Db> {
  return freshTestDb();
}

async function seedMailbox(db: Db): Promise<string> {
  const [ws] = await db.insert(workspaces).values({ name: 'WS' }).returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'o@declutrmail.ai' })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({ workspaceId: ws!.id, userId: user!.id, provider: 'gmail', providerAccountId: 'o@x' })
    .returning({ id: mailboxAccounts.id });
  return mailbox!.id;
}

async function seedSender(db: Db, mailboxAccountId: string): Promise<string> {
  const [s] = await db
    .insert(senders)
    .values({
      mailboxAccountId,
      senderKey: SENDER_KEY,
      email: 'news@shop.example',
      domain: 'shop.example',
      gmailCategory: 'promotions',
      firstSeenAt: new Date('2026-01-01'),
      lastSeenAt: new Date('2026-05-01'),
    })
    .returning({ id: senders.id });
  return s!.id;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

async function seedMessage(
  db: Db,
  mailboxAccountId: string,
  pid: string,
  labels: string[],
  internalDate: Date,
  isOutbound = false,
  senderKey: string = SENDER_KEY,
): Promise<void> {
  await db.insert(mailMessages).values({
    mailboxAccountId,
    providerMessageId: pid,
    providerThreadId: `t-${pid}`,
    senderKey,
    internalDate,
    isUnread: false,
    labelIds: labels,
    isOutbound,
  });
}

/** Second distinct sender for the multi-sender (bulk) cases. */
const SENDER_KEY_2 = 'e'.repeat(64);

async function seedSecondSender(db: Db, mailboxAccountId: string): Promise<string> {
  const [s] = await db
    .insert(senders)
    .values({
      mailboxAccountId,
      senderKey: SENDER_KEY_2,
      email: 'promo@brand.example',
      domain: 'brand.example',
      gmailCategory: 'promotions',
      firstSeenAt: new Date('2026-01-01'),
      lastSeenAt: new Date('2026-05-01'),
    })
    .returning({ id: senders.id });
  return s!.id;
}

/** Records batchModify calls; never talks to Gmail. Runs the hook as the real client does. */
class FakeMutationClient implements GmailMutationClient {
  calls: { ids: string[]; change?: unknown }[] = [];
  async modifyLabels(): Promise<void> {}
  async batchModify(
    messageIds: string[],
    change?: unknown,
    opts: BatchModifyOptions = {},
  ): Promise<void> {
    await opts.beforeFirstRequest?.();
    this.calls.push({ ids: [...messageIds], change });
  }
  async ensureLabelId(name: string): Promise<string> {
    return `Label_${name}`;
  }
}

const CTX: WorkerContext = {
  jobId: 'job-1',
  workerName: 'LabelActionWorker',
  attempt: 1,
  maxAttempts: 5,
  startedAt: new Date(),
  policy: 'perMailboxPolicy',
};

describe('action pipeline contract — preview == enqueue == worker == receipt', () => {
  let db: Db;
  let mailboxId: string;
  let senderId: string;
  let svc: ActionsService;
  let gmail: FakeMutationClient;
  let worker: LabelActionWorker;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db);
    senderId = await seedSender(db, mailboxId);
    const queue = { add: async () => {}, getJob: async () => null };
    svc = new ActionsService(db as never, queue as never);
    gmail = new FakeMutationClient();
    const access: GmailMutationAccess = { getClient: async () => gmail };
    worker = new LabelActionWorker({
      db: db as never,
      gmailMutation: access,
      outbox: new OutboxPublisher(),
      lock: PASSTHROUGH_MAILBOX_LOCK,
    });
  });

  it('agrees end-to-end on a mixed inbound/outbound mailbox, with and without a window', async () => {
    // The scenario from finding 5.5: inbound inbox mail in and out of the
    // window, self-CC mail carrying SENT + INBOX, outbound-only mail, and
    // an archived row.
    await seedMessage(db, mailboxId, 'in-recent', ['INBOX'], daysAgo(10));
    await seedMessage(db, mailboxId, 'in-old', ['INBOX'], daysAgo(400));
    await seedMessage(db, mailboxId, 'self-cc', ['SENT', 'INBOX'], daysAgo(5), true);
    await seedMessage(db, mailboxId, 'sent-only', ['SENT'], daysAgo(5), true);
    await seedMessage(db, mailboxId, 'archived', ['CATEGORY_PROMOTIONS'], daysAgo(20));

    const preview = await svc.previewComposite({ mailboxAccountId: mailboxId, senderId });
    expect(preview.counts.all).toBe(2);
    expect(preview.counts.olderThan365d).toBe(1);

    // Whole-inbox archive: preview == requested == resolved == receipt.
    const all = await svc.enqueueComposite({
      mailboxAccountId: mailboxId,
      selector: { type: 'sender', senderId },
      primary: { type: 'archive' },
      idempotencyKey: 'chain-all',
      override: false,
    });
    expect(all.primaryCount).toBe(preview.counts.all);

    const allRun = await worker.processJob(
      { actionId: all.actionId, mailboxAccountId: mailboxId, idempotencyKey: 'archive-chain-all' },
      CTX,
    );
    expect(gmail.calls[0]!.ids.sort()).toEqual(['in-old', 'in-recent']);
    expect(allRun.affectedCount).toBe(preview.counts.all);

    const [allRow] = await db.select().from(actionJobs).where(eq(actionJobs.id, all.actionId));
    expect(allRow!.requestedCount).toBe(preview.counts.all);
    expect(allRow!.affectedCount).toBe(preview.counts.all);
    expect(allRow!.resolvedMessageIds.sort()).toEqual(['in-old', 'in-recent']);

    const activity = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.mailboxAccountId, mailboxId));
    expect(activity[0]!.affectedCount).toBe(preview.counts.all);

    // Windowed archive on a fresh equivalent mailbox state: the 365d
    // bucket the chip row showed is exactly what the worker moves.
    // (`in-recent`/`in-old` were archived above, so re-seed.)
    await seedMessage(db, mailboxId, 'w-in-recent', ['INBOX'], daysAgo(10));
    await seedMessage(db, mailboxId, 'w-in-old', ['INBOX'], daysAgo(400));
    await seedMessage(db, mailboxId, 'w-self-old', ['SENT', 'INBOX'], daysAgo(400), true);

    const windowedPreview = await svc.previewComposite({ mailboxAccountId: mailboxId, senderId });
    expect(windowedPreview.counts.olderThan365d).toBe(1);

    const windowed = await svc.enqueueComposite({
      mailboxAccountId: mailboxId,
      selector: { type: 'sender', senderId },
      primary: { type: 'archive', olderThanDays: 365 },
      idempotencyKey: 'chain-365',
      override: false,
    });
    expect(windowed.primaryCount).toBe(windowedPreview.counts.olderThan365d);

    const windowedRun = await worker.processJob(
      {
        actionId: windowed.actionId,
        mailboxAccountId: mailboxId,
        idempotencyKey: 'archive-chain-365',
      },
      CTX,
    );
    expect(gmail.calls[1]!.ids).toEqual(['w-in-old']);
    expect(windowedRun.affectedCount).toBe(windowedPreview.counts.olderThan365d);
  });
});

/**
 * D245 — Protected senders are excluded from bulk mail-changing actions,
 * and the exclusion has to hold at EXECUTION, not only at enqueue.
 *
 * `enqueueBulkComposite` drops Protected senders once, when the user
 * clicks. The jobs then wait on the per-mailbox advisory lock — tens of
 * seconds in production — and a sender can become Protected inside that
 * window: the user clicks Protect, or incremental sync's automatic
 * protection fires on a new star. These specs run the real enqueue, the
 * real policy write and the real worker against one database, with the
 * exact BullMQ payload the API produced, so the join between the enqueue
 * check and the worker is what is under test.
 */
describe('action pipeline contract — a sender protected while its job waits', () => {
  let db: Db;
  let mailboxId: string;
  let senderId: string;
  let svc: ActionsService;
  let policy: SendersPolicyService;
  let gmail: FakeMutationClient;
  let worker: LabelActionWorker;
  let enqueued: LabelActionJobData[];

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db);
    senderId = await seedSender(db, mailboxId);
    await db.update(workspaces).set({ tier: 'plus' });
    enqueued = [];
    const queue = {
      add: async (_name: string, data: LabelActionJobData) => {
        enqueued.push(data);
      },
      getJob: async () => null,
    };
    svc = new ActionsService(db as never, queue as never);
    policy = new SendersPolicyService(db as never);
    gmail = new FakeMutationClient();
    const access: GmailMutationAccess = { getClient: async () => gmail };
    worker = new LabelActionWorker({
      db: db as never,
      gmailMutation: access,
      outbox: new OutboxPublisher(),
      lock: PASSTHROUGH_MAILBOX_LOCK,
    });
  });

  /** Drain everything enqueued so far through the worker, in order. */
  async function drain(): Promise<void> {
    for (const job of enqueued.splice(0)) {
      await worker.processJob(job, CTX);
    }
  }

  it('bulk Delete never touches a sender that became Protected after the click', async () => {
    const sender2Id = await seedSecondSender(db, mailboxId);
    await seedMessage(db, mailboxId, 'a-1', ['INBOX'], daysAgo(5));
    await seedMessage(db, mailboxId, 'a-2', ['INBOX'], daysAgo(9));
    await seedMessage(db, mailboxId, 'b-1', ['INBOX'], daysAgo(5), false, SENDER_KEY_2);

    const res = await svc.enqueueBulkComposite({
      mailboxAccountId: mailboxId,
      senderIds: [senderId, sender2Id],
      primary: { type: 'delete' },
      idempotencyKey: 'bulk-del-protect-race',
    });
    // Neither sender was Protected at the click, so both were enqueued.
    expect(res.skipped).toEqual([]);
    expect(enqueued).toHaveLength(2);

    // While both jobs wait for the mailbox lock, the user protects A.
    await policy.setPolicy({ mailboxAccountId: mailboxId, senderId, patch: { isProtected: true } });

    await drain();

    const touched = gmail.calls.flatMap((c) => c.ids);
    expect(touched).not.toContain('a-1');
    expect(touched).not.toContain('a-2');
    // Protection is per sender, never batch-wide: B still goes.
    expect(touched).toEqual(['b-1']);

    const aMail = await db
      .select({ labelIds: mailMessages.labelIds })
      .from(mailMessages)
      .where(eq(mailMessages.senderKey, SENDER_KEY));
    expect(aMail.map((m) => m.labelIds)).toEqual([['INBOX'], ['INBOX']]);

    // Same outcome as a sender skipped at the click: A's job ends with
    // nothing changed and no undo, and records no Delete — nothing happened.
    const [aJob] = await db
      .select()
      .from(actionJobs)
      .where(sql`${actionJobs.selector}->>'senderKey' = ${SENDER_KEY}`);
    expect(aJob).toMatchObject({
      status: 'done',
      affectedCount: 0,
      undoToken: null,
      errorCode: LABEL_SENDER_PROTECTED_ERROR_CODE,
    });
    const aDeletes = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.senderKey, SENDER_KEY), eq(activityLog.action, 'delete')));
    expect(aDeletes).toEqual([]);
    const aEvents = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, aJob!.id));
    expect(aEvents).toEqual([]);

    // The receipt can say what happened: one sender skipped, one done.
    await expect(svc.getBatchStatus(res.batchId, mailboxId)).resolves.toMatchObject({
      status: 'done',
      total: 1,
      done: 1,
      failed: 0,
      affectedCount: 1,
      skippedProtectedSenderIds: [senderId],
    });
  });

  it('a single-sender Delete with no "…anyway" confirm skips a sender protected before it ran', async () => {
    await seedMessage(db, mailboxId, 'a-1', ['INBOX'], daysAgo(5));

    const res = await svc.enqueueComposite({
      mailboxAccountId: mailboxId,
      selector: { type: 'sender', senderId },
      primary: { type: 'delete' },
      idempotencyKey: 'del-protected-after-click',
      override: false,
    });
    await policy.setPolicy({ mailboxAccountId: mailboxId, senderId, patch: { isProtected: true } });
    await drain();

    expect(gmail.calls).toEqual([]);
    await expect(svc.getBatchStatus(res.actionId, mailboxId)).resolves.toMatchObject({
      status: 'done',
      total: 0,
      skippedProtectedSenderIds: [senderId],
    });
  });

  it('Undo still restores mail after the sender became Protected — reverse is never blocked', async () => {
    await seedMessage(db, mailboxId, 'a-1', ['INBOX'], daysAgo(5));

    const fwd = await svc.enqueueComposite({
      mailboxAccountId: mailboxId,
      selector: { type: 'sender', senderId },
      primary: { type: 'delete' },
      idempotencyKey: 'del-then-undo',
      override: false,
    });
    await drain();
    const [forward] = await db.select().from(actionJobs).where(eq(actionJobs.id, fwd.actionId));
    expect(forward!.undoToken).not.toBeNull();

    await policy.setPolicy({ mailboxAccountId: mailboxId, senderId, patch: { isProtected: true } });

    await svc.enqueueCompositeRevert({ mailboxAccountId: mailboxId, token: forward!.undoToken! });
    await drain();

    expect(gmail.calls).toHaveLength(2);
    expect(gmail.calls[1]!.ids).toEqual(['a-1']);
    const [restored] = await db
      .select({ labelIds: mailMessages.labelIds })
      .from(mailMessages)
      .where(eq(mailMessages.providerMessageId, 'a-1'));
    expect(restored!.labelIds).toContain('INBOX');
    expect(restored!.labelIds).not.toContain('TRASH');
  });

  it('a single-sender Delete the user confirmed on a Protected sender still runs', async () => {
    await seedMessage(db, mailboxId, 'a-1', ['INBOX'], daysAgo(5));
    await policy.setPolicy({ mailboxAccountId: mailboxId, senderId, patch: { isProtected: true } });

    await expect(
      svc.enqueueComposite({
        mailboxAccountId: mailboxId,
        selector: { type: 'sender', senderId },
        primary: { type: 'delete' },
        idempotencyKey: 'del-protected-unconfirmed',
        override: false,
      }),
    ).rejects.toMatchObject({ response: { code: 'PROTECTED_SENDER' } });

    await svc.enqueueComposite({
      mailboxAccountId: mailboxId,
      selector: { type: 'sender', senderId },
      primary: { type: 'delete' },
      idempotencyKey: 'del-protected-confirmed',
      override: true,
    });
    await drain();

    expect(gmail.calls.flatMap((c) => c.ids)).toEqual(['a-1']);
  });
});

/**
 * Founder decision 2026-09-26, end to end: a retry from Activity whose
 * sender turned Protected after its review said "not Protected" never
 * touches Gmail — it fails and stays reviewable; the next review says
 * Protected, and its Confirm carries the consent the worker honours.
 * Real ActionRecoveryService → the payload it enqueues → real worker.
 */
describe('action pipeline contract — a retry whose sender turned Protected after review', () => {
  let db: Db;
  let mailboxId: string;
  let senderId: string;
  let recovery: ActionRecoveryService;
  let policy: SendersPolicyService;
  let gmail: FakeMutationClient;
  let worker: LabelActionWorker;
  let enqueued: LabelActionJobData[];

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db);
    senderId = await seedSender(db, mailboxId);
    enqueued = [];
    const actionQueue = {
      add: async (_name: string, data: LabelActionJobData) => {
        enqueued.push(data);
      },
    };
    const verificationQueue = { add: async () => undefined };
    recovery = new ActionRecoveryService(
      db as never,
      actionQueue as never,
      verificationQueue as never,
    );
    policy = new SendersPolicyService(db as never);
    gmail = new FakeMutationClient();
    worker = new LabelActionWorker({
      db: db as never,
      gmailMutation: { getClient: async () => gmail },
      outbox: new OutboxPublisher(),
      lock: PASSTHROUGH_MAILBOX_LOCK,
    });
  });

  /** A verified, ready review of `actionId` whose retry re-applies ['r-1']. */
  async function readyReview(actionId: string): Promise<string> {
    const started = await recovery.createPreview({ mailboxAccountId: mailboxId, actionId });
    await db
      .update(actionRecoveryPreviews)
      .set({
        status: 'ready',
        outcome: 'not_applied',
        targetMessageIds: ['r-1'],
        remainingMessageIds: ['r-1'],
        verifiedCount: 1,
        verifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(actionRecoveryPreviews.id, started.previewId));
    return started.previewId;
  }

  it('stops the unconsented retry, and runs the one the review said was Protected', async () => {
    await seedMessage(db, mailboxId, 'r-1', ['INBOX'], daysAgo(5));
    const [failed] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'archive',
        direction: 'forward',
        selector: { type: 'sender', senderId, senderKey: SENDER_KEY },
        resolvedMessageIds: ['r-1'],
        requestedCount: 1,
        status: 'failed',
        errorCode: 'TransientError',
        idempotencyKey: 'failed-archive',
      })
      .returning();

    // The review says "not Protected"; Confirm carries no consent.
    const first = await readyReview(failed!.id);
    await expect(recovery.getPreview(mailboxId, first)).resolves.toMatchObject({
      senderProtected: false,
    });
    const retry = await recovery.confirmPreview({
      mailboxAccountId: mailboxId,
      previewId: first,
      idempotencyKey: 'retry-1',
      wakeAt: null,
    });
    // Protected while the retry waits its turn.
    await policy.setPolicy({ mailboxAccountId: mailboxId, senderId, patch: { isProtected: true } });
    for (const job of enqueued.splice(0)) await worker.processJob(job, CTX);

    expect(gmail.calls).toEqual([]);
    const [stopped] = await db.select().from(actionJobs).where(eq(actionJobs.id, retry.actionId));
    expect(stopped).toMatchObject({
      status: 'failed',
      errorCode: RECOVERY_SENDER_PROTECTED_ERROR_CODE,
    });

    // Reviewed again: the review names the protection, and "…anyway"
    // carries the consent through to the worker.
    const second = await readyReview(retry.actionId);
    await expect(recovery.getPreview(mailboxId, second)).resolves.toMatchObject({
      senderProtected: true,
    });
    await recovery.confirmPreview({
      mailboxAccountId: mailboxId,
      previewId: second,
      idempotencyKey: 'retry-2',
      wakeAt: null,
      senderProtected: true,
    });
    for (const job of enqueued.splice(0)) await worker.processJob(job, CTX);

    expect(gmail.calls.map((call) => call.ids)).toEqual([['r-1']]);
  });
});
