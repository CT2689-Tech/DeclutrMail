import type { schema } from '@declutrmail/db';
import {
  actionJobs,
  mailMessages,
  mailboxAccounts,
  senderPolicies,
  senders,
  undoJournal,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { METER } from '@declutrmail/shared/entitlements';

import { EntitlementsService } from '../common/entitlements/entitlements.service.js';
import { ActionsService } from './actions.service.js';
import { UnsubscribeBacklogService } from './unsubscribe-backlog.service.js';

const SENDER_KEY = 'b'.repeat(64);

type Db = ReturnType<typeof drizzle<typeof schema>>;

function fakeQueue() {
  const q = {
    count: 0,
    jobIds: [] as string[],
    add: async (_job: unknown, _data: unknown, opts: { jobId?: string }) => {
      if (opts?.jobId && opts.jobId.includes(':')) {
        throw new Error('Custom Id cannot contain :');
      }
      if (opts?.jobId && q.jobIds.includes(opts.jobId)) return;
      q.count += 1;
      if (opts?.jobId) q.jobIds.push(opts.jobId);
    },
    getJob: async () => null,
  };
  return q;
}

async function seedMailbox(db: Db): Promise<{ mailboxId: string; workspaceId: string }> {
  const [ws] = await db.insert(workspaces).values({ name: 'WS' }).returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'o@declutrmail.ai' })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: 'o@x',
    })
    .returning({ id: mailboxAccounts.id });
  return { mailboxId: mailbox!.id, workspaceId: ws!.id };
}

async function seedSender(db: Db, mailboxAccountId: string): Promise<string> {
  const [row] = await db
    .insert(senders)
    .values({
      mailboxAccountId,
      senderKey: SENDER_KEY,
      email: 'news@shop.example',
      domain: 'shop.example',
      gmailCategory: 'promotions',
      firstSeenAt: new Date('2026-01-01'),
      lastSeenAt: new Date('2026-05-01'),
      unsubscribeMethod: 'one_click',
      unsubscribeUrl: 'https://unsub.shop.example/oc',
    })
    .returning({ id: senders.id });
  return row!.id;
}

async function seedInbox(db: Db, mailboxAccountId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await db.insert(mailMessages).values({
      mailboxAccountId,
      providerMessageId: `m-${i}`,
      providerThreadId: `t-${i}`,
      senderKey: SENDER_KEY,
      internalDate: new Date('2026-05-01'),
      isUnread: false,
      labelIds: ['INBOX'],
      isOutbound: false,
    });
  }
}

describe('UnsubscribeBacklogService', () => {
  let db: Db;
  let mailboxId: string;
  let workspaceId: string;
  let senderId: string;
  let labelQueue: ReturnType<typeof fakeQueue>;
  let unsubQueue: ReturnType<typeof fakeQueue>;
  let actions: ActionsService;
  let svc: UnsubscribeBacklogService;
  let entitlements: EntitlementsService;

  beforeAll(() => {
    process.env.UNSUB_SEND_ENABLED = 'true';
  });

  beforeEach(async () => {
    db = await freshTestDb();
    ({ mailboxId, workspaceId } = await seedMailbox(db));
    senderId = await seedSender(db, mailboxId);
    labelQueue = fakeQueue();
    unsubQueue = fakeQueue();
    actions = new ActionsService(db as never, labelQueue as never, undefined, unsubQueue as never);
    entitlements = new EntitlementsService(db as never);
    svc = new UnsubscribeBacklogService(actions, entitlements, db as never);
    delete process.env.METER_V2;
  });

  afterEach(() => {
    process.env.UNSUB_SEND_ENABLED = 'true';
    delete process.env.METER_V2;
  });

  it.each([
    { mode: 'archive' as const, reach: 'inbox_only' as const, olderThanDays: 180, expected: 1 },
    { mode: 'archive' as const, reach: 'inbox_only' as const, olderThanDays: null, expected: 2 },
    { mode: 'delete' as const, reach: 'all_mail' as const, olderThanDays: 180, expected: 2 },
    { mode: 'delete' as const, reach: 'all_mail' as const, olderThanDays: null, expected: 4 },
  ])(
    'persists the previewed age and reach for $mode at $olderThanDays days',
    async ({ mode, reach, olderThanDays, expected }) => {
      const rows = [
        { id: 'old-inbox', days: 250, labels: ['INBOX'] },
        { id: 'recent-inbox', days: 10, labels: ['INBOX'] },
        { id: 'old-archived', days: 300, labels: [] },
        { id: 'recent-archived', days: 10, labels: [] },
        { id: 'old-trash', days: 300, labels: ['TRASH'] },
      ];
      await db.insert(mailMessages).values(
        rows.map((row) => ({
          mailboxAccountId: mailboxId,
          providerMessageId: row.id,
          providerThreadId: row.id,
          senderKey: SENDER_KEY,
          internalDate: new Date(Date.now() - row.days * 86400000),
          labelIds: row.labels,
          isOutbound: false,
          isUnread: false,
        })),
      );
      const result = await svc.confirm({
        mailboxAccountId: mailboxId,
        idempotencyKey: `age-${mode}-${olderThanDays}`,
        mode,
        senderIds: [senderId],
        olderThanDays,
        reach,
      });
      expect(result.backlog?.requestedCount).toBe(expected);
      expect(labelQueue.count).toBe(1);
      expect(unsubQueue.count).toBe(1);
      const jobs = await db
        .select()
        .from(actionJobs)
        .where(eq(actionJobs.mailboxAccountId, mailboxId));
      const cleanup = jobs.find((job) => job.verb === mode);
      expect(cleanup).toMatchObject({ olderThanDays, reach, requestedCount: expected });
    },
  );

  it('enqueues the backlog before any unsubscribe intent', async () => {
    await seedInbox(db, mailboxId, 4);
    const events: string[] = [];
    const enqueue = actions.enqueueComposite.bind(actions);
    const record = actions.recordUnsubscribeIntent.bind(actions);
    vi.spyOn(actions, 'enqueueComposite').mockImplementation(async (input) => {
      events.push('enqueue');
      return enqueue(input);
    });
    vi.spyOn(actions, 'recordUnsubscribeIntent').mockImplementation(async (input) => {
      events.push('unsub');
      return record(input);
    });

    const result = await svc.confirm({
      mailboxAccountId: mailboxId,
      idempotencyKey: 'order-key-1',
      mode: 'archive',
      senderIds: [senderId],
    });

    expect(events).toEqual(['enqueue', 'unsub']);
    expect(result.backlog?.requestedCount).toBe(4);
    expect(result.backlog?.handle).toBe('action');
    expect(result.backlog).not.toHaveProperty('movedBytes');
    expect(labelQueue.count).toBe(1);
    expect(unsubQueue.count).toBe(1);
    const [unsub] = await db
      .select({ compositeId: actionJobs.compositeId })
      .from(actionJobs)
      .where(eq(actionJobs.idempotencyKey, `unsub:order-key-1-${senderId}`));
    expect(unsub?.compositeId).toBe(result.backlog?.actionId);
    expect(await entitlements.cleanupUnitsUsed(workspaceId)).toBe(1);
  });

  it.each(['accepted', 'unconfirmed', 'failed'] as const)(
    'groups real one-click execution with Delete, excluding the intent (%s)',
    async (outcome) => {
      await seedInbox(db, mailboxId, 1);
      const result = await svc.confirm({
        mailboxAccountId: mailboxId,
        idempotencyKey: 'feedback-real',
        mode: 'delete',
        senderIds: [senderId],
      });
      const groupId = result.backlog!.actionId;
      const executionId = result.senders[0]!.executionActionId!;
      expect(result.feedbackVersion).toBe(2);
      expect(await actions.listInFlight(mailboxId)).toMatchObject([
        { groupId, mixedVerbs: true, total: 2, done: 0, failed: 0, running: true },
      ]);
      expect((await actions.getBatchStatus(groupId, mailboxId)).unsubscribeOutcomes).toMatchObject({
        endpointAccepted: 0,
        pending: 1,
      });
      await db
        .update(actionJobs)
        .set({ status: 'done', affectedCount: 1 })
        .where(eq(actionJobs.id, groupId));
      expect((await actions.listInFlight(mailboxId))[0]).toMatchObject({
        total: 2,
        done: 1,
        running: true,
      });
      await db
        .update(actionJobs)
        .set({
          status: outcome === 'accepted' ? 'done' : 'failed',
          affectedCount: outcome === 'accepted' ? 1 : 0,
          errorCode:
            outcome === 'unconfirmed'
              ? 'UNSUB_AMBIGUOUS_REDIRECT'
              : outcome === 'failed'
                ? 'HTTP_500'
                : null,
        })
        .where(eq(actionJobs.id, executionId));
      expect(await actions.getBatchStatus(groupId, mailboxId)).toMatchObject({
        feedbackVersion: 2,
        total: 2,
        done: outcome === 'accepted' ? 2 : 1,
        failed: outcome === 'accepted' ? 0 : 1,
        affectedCount: outcome === 'accepted' ? 2 : 1,
        unsubscribeOutcomes: {
          endpointAccepted: outcome === 'accepted' ? 1 : 0,
          unconfirmed: outcome === 'unconfirmed' ? 1 : 0,
          failed: outcome === 'failed' ? 1 : 0,
          pending: 0,
        },
      });
    },
  );

  it('leaves an older ungrouped execution on independent feedback after same-key replay', async () => {
    await seedInbox(db, mailboxId, 1);
    const input = {
      mailboxAccountId: mailboxId,
      idempotencyKey: 'feedback-older',
      mode: 'delete' as const,
      senderIds: [senderId],
    };
    const first = await svc.confirm(input);
    await db
      .update(actionJobs)
      .set({ compositeId: null })
      .where(eq(actionJobs.id, first.senders[0]!.executionActionId!));
    expect((await svc.confirm(input)).feedbackVersion).toBeUndefined();
    expect(labelQueue.count).toBe(1);
    expect(unsubQueue.count).toBe(1);
  });

  it('never treats a manual unsubscribe intent as endpoint acceptance', async () => {
    await db
      .update(senders)
      .set({ unsubscribeMethod: 'mailto', unsubscribeUrl: 'mailto:leave@shop.example' })
      .where(eq(senders.id, senderId));
    await seedInbox(db, mailboxId, 1);
    const result = await svc.confirm({
      mailboxAccountId: mailboxId,
      idempotencyKey: 'feedback-manual',
      mode: 'delete',
      senderIds: [senderId],
    });
    expect(result.senders[0]?.unsubStatus).toBe('manual');
    expect(
      (await actions.getBatchStatus(result.backlog!.actionId, mailboxId)).unsubscribeOutcomes,
    ).toBeNull();
    expect(await actions.listInFlight(mailboxId)).toMatchObject([{ total: 1, mixedVerbs: false }]);
  });

  it('402s on the email count under METER_V2 and sends no unsubscribe', async () => {
    process.env.METER_V2 = 'true';
    const alreadyCleared = METER.free.limit - 3;
    await db.insert(actionJobs).values({
      mailboxAccountId: mailboxId,
      verb: 'archive',
      direction: 'forward',
      selector: { type: 'sender', senderId, senderKey: SENDER_KEY },
      requestedCount: alreadyCleared,
      affectedCount: alreadyCleared,
      quotaUnits: alreadyCleared,
      status: 'done',
      idempotencyKey: 'prior-emails',
    });
    await seedInbox(db, mailboxId, 4);
    const record = vi.spyOn(actions, 'recordUnsubscribeIntent');

    await expect(
      svc.confirm({
        mailboxAccountId: mailboxId,
        idempotencyKey: 'cap-key-01',
        mode: 'archive',
        senderIds: [senderId],
      }),
    ).rejects.toMatchObject({ code: 'FREE_CAP_REACHED' });

    expect(record).not.toHaveBeenCalled();
    expect(labelQueue.count).toBe(0);
    expect(unsubQueue.count).toBe(0);
    const jobs = await db
      .select({ verb: actionJobs.verb })
      .from(actionJobs)
      .where(eq(actionJobs.mailboxAccountId, mailboxId));
    expect(jobs.some((job) => job.verb === 'unsubscribe')).toBe(false);
  });

  it('still archives when the unsubscribe send is refused', async () => {
    await seedInbox(db, mailboxId, 2);
    delete process.env.UNSUB_SEND_ENABLED;
    const result = await svc.confirm({
      mailboxAccountId: mailboxId,
      idempotencyKey: 'fail-key-1',
      mode: 'archive',
      senderIds: [senderId],
    });
    expect(result.backlog?.verb).toBe('archive');
    expect(result.senders[0]?.unsubStatus).toBe('failed');
    expect(result.senders[0]?.reasonCode).toBe('send_disabled');
    expect(labelQueue.count).toBe(1);
    expect(unsubQueue.count).toBe(0);
  });

  it('still records unsubscribe when the archive job is already in progress', async () => {
    const otherKey = 'c'.repeat(64);
    const [other] = await db
      .insert(senders)
      .values({
        mailboxAccountId: mailboxId,
        senderKey: otherKey,
        email: 'also@shop.example',
        domain: 'shop.example',
        gmailCategory: 'promotions',
        firstSeenAt: new Date('2026-01-01'),
        lastSeenAt: new Date('2026-05-01'),
        unsubscribeMethod: 'one_click',
        unsubscribeUrl: 'https://unsub.shop.example/also',
      })
      .returning({ id: senders.id });
    await seedInbox(db, mailboxId, 1);
    await db.insert(mailMessages).values({
      mailboxAccountId: mailboxId,
      providerMessageId: 'busy-m',
      providerThreadId: 'busy-t',
      senderKey: otherKey,
      internalDate: new Date('2026-05-01'),
      isUnread: false,
      labelIds: ['INBOX'],
      isOutbound: false,
    });
    await db.insert(actionJobs).values({
      mailboxAccountId: mailboxId,
      verb: 'archive',
      direction: 'forward',
      selector: { type: 'sender', senderId: other!.id, senderKey: otherKey },
      status: 'executing',
      idempotencyKey: 'busy-archive',
      requestedCount: 1,
    });

    const result = await svc.confirm({
      mailboxAccountId: mailboxId,
      idempotencyKey: 'busy-key-1',
      mode: 'archive',
      senderIds: [senderId, other!.id],
    });

    expect(result.senders.find((row) => row.senderId === other!.id)?.unsubStatus).toBe('requested');
    expect(unsubQueue.count).toBe(2);
  });

  it('reports a requested sender id that is no longer in the table', async () => {
    const missingId = '11111111-1111-4111-8111-111111111111';
    const mixed = await svc.confirm({
      mailboxAccountId: mailboxId,
      idempotencyKey: 'gone-row-1',
      mode: 'unsub_only',
      senderIds: [senderId, missingId],
    });
    expect(mixed.senders.find((row) => row.senderId === missingId)).toMatchObject({
      unsubStatus: 'skipped',
      reasonCode: 'not_found',
    });
    expect(mixed.senders.find((row) => row.senderId === senderId)?.unsubStatus).toBe('requested');

    const onlyMissing = await svc.confirm({
      mailboxAccountId: mailboxId,
      idempotencyKey: 'gone-row-2',
      mode: 'unsub_only',
      senderIds: ['22222222-2222-4222-8222-222222222222'],
    });
    expect(onlyMissing.backlog).toBeNull();
    expect(onlyMissing.senders).toEqual([
      expect.objectContaining({
        senderId: '22222222-2222-4222-8222-222222222222',
        unsubStatus: 'skipped',
        reasonCode: 'not_found',
      }),
    ]);
  });

  it('returns the size-estimate sum when a Delete moves every counted message', async () => {
    await seedInbox(db, mailboxId, 4);
    await db
      .update(mailMessages)
      .set({ sizeBytes: 250_000 })
      .where(eq(mailMessages.mailboxAccountId, mailboxId));
    const result = await svc.confirm({
      mailboxAccountId: mailboxId,
      idempotencyKey: 'size-key-1',
      mode: 'delete',
      senderIds: [senderId],
    });
    expect(result.backlog).toMatchObject({
      verb: 'delete',
      requestedCount: 4,
      movedBytes: 1_000_000,
    });
  });

  it('maps an in-flight unsubscribe and a missing sender', async () => {
    await seedInbox(db, mailboxId, 1);
    const record = vi.spyOn(actions, 'recordUnsubscribeIntent');
    record.mockRejectedValueOnce(
      new ConflictException({
        code: 'UNSUBSCRIBE_IN_FLIGHT',
        message: 'An unsubscribe request to this sender is already on its way.',
      }),
    );
    const inFlight = await svc.confirm({
      mailboxAccountId: mailboxId,
      idempotencyKey: 'inflight-key-1',
      mode: 'unsub_only',
      senderIds: [senderId],
    });
    expect(inFlight.senders[0]?.reasonCode).toBe('in_flight');

    record.mockRejectedValueOnce(
      new NotFoundException({
        code: 'SENDER_NOT_FOUND',
        message: 'We couldn’t find this sender in this Gmail account.',
      }),
    );
    const missing = await svc.confirm({
      mailboxAccountId: mailboxId,
      idempotencyKey: 'missing-key-1',
      mode: 'unsub_only',
      senderIds: [senderId],
    });
    expect(missing.senders[0]?.reasonCode).toBe('not_found');
  });

  it('returns a mailto draft and does not enqueue a send', async () => {
    await seedInbox(db, mailboxId, 1);
    await db
      .update(senders)
      .set({ unsubscribeMethod: 'mailto', unsubscribeUrl: 'mailto:news@shop.example' })
      .where(eq(senders.id, senderId));
    const result = await svc.confirm({
      mailboxAccountId: mailboxId,
      idempotencyKey: 'mail-key-1',
      mode: 'delete',
      senderIds: [senderId],
    });
    expect(result.senders[0]?.unsubStatus).toBe('manual');
    expect(result.senders[0]?.mailtoUrl).toBe('mailto:news@shop.example');
    expect(unsubQueue.count).toBe(0);
    expect(result.backlog?.verb).toBe('delete');
  });

  it('names a missing unsubscribe link and still runs the backlog', async () => {
    await seedInbox(db, mailboxId, 2);
    await db
      .update(senders)
      .set({ unsubscribeMethod: 'none', unsubscribeUrl: null })
      .where(eq(senders.id, senderId));
    const result = await svc.confirm({
      mailboxAccountId: mailboxId,
      idempotencyKey: 'none-key-1',
      mode: 'archive',
      senderIds: [senderId],
    });
    expect(result.senders[0]?.reasonCode).toBe('no_link');
    expect(result.backlog).not.toBeNull();
    expect(unsubQueue.count).toBe(0);
  });

  it('names a Protected sender as skipped, not as an error', async () => {
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_KEY,
      isProtected: true,
      protectionReason: 'user_defined',
    });
    await seedInbox(db, mailboxId, 2);
    const result = await svc.confirm({
      mailboxAccountId: mailboxId,
      idempotencyKey: 'prot-only-1',
      mode: 'archive',
      senderIds: [senderId],
    });
    expect(result.backlog).toBeNull();
    expect(result.senders[0]).toMatchObject({
      senderId,
      unsubStatus: 'skipped',
      reasonCode: 'protected',
    });
    expect(unsubQueue.count).toBe(0);
    expect(labelQueue.count).toBe(0);
  });

  it('names a sender the move no longer finds', async () => {
    const otherKey = 'd'.repeat(64);
    const [other] = await db
      .insert(senders)
      .values({
        mailboxAccountId: mailboxId,
        senderKey: otherKey,
        email: 'gone@shop.example',
        domain: 'shop.example',
        gmailCategory: 'promotions',
        firstSeenAt: new Date('2026-01-01'),
        lastSeenAt: new Date('2026-05-01'),
        unsubscribeMethod: 'one_click',
        unsubscribeUrl: 'https://unsub.shop.example/gone',
      })
      .returning({ id: senders.id });
    await seedInbox(db, mailboxId, 1);
    vi.spyOn(actions, 'enqueueBulkComposite').mockResolvedValue({
      batchId: '11111111-1111-4111-8111-111111111111',
      status: 'queued',
      senderCount: 1,
      requestedTotal: 1,
      wakeAt: null,
      skipped: [{ senderId: other!.id, reason: 'not_found' }],
    });

    const result = await svc.confirm({
      mailboxAccountId: mailboxId,
      idempotencyKey: 'missing-move-1',
      mode: 'archive',
      senderIds: [senderId, other!.id],
    });

    expect(result.backlog).toMatchObject({
      handle: 'batch',
      actionId: '11111111-1111-4111-8111-111111111111',
    });
    expect(result.senders.find((row) => row.senderId === other!.id)).toMatchObject({
      unsubStatus: 'skipped',
      reasonCode: 'not_found',
    });
  });

  it('keeps mailto, a missing link, and an unknown method off the not-found skip', async () => {
    const [other] = await db
      .insert(senders)
      .values({
        mailboxAccountId: mailboxId,
        senderKey: 'e'.repeat(64),
        email: 'hand@shop.example',
        domain: 'shop.example',
        gmailCategory: 'promotions',
        firstSeenAt: new Date('2026-01-01'),
        lastSeenAt: new Date('2026-05-01'),
        unsubscribeMethod: 'mailto',
      })
      .returning({ id: senders.id });
    const [unknown] = await db
      .insert(senders)
      .values({
        mailboxAccountId: mailboxId,
        senderKey: 'f'.repeat(64),
        email: 'unknown@shop.example',
        domain: 'shop.example',
        gmailCategory: 'promotions',
        firstSeenAt: new Date('2026-01-01'),
        lastSeenAt: new Date('2026-05-01'),
        unsubscribeMethod: 'none',
      })
      .returning({ id: senders.id });
    await seedInbox(db, mailboxId, 1);
    vi.spyOn(actions, 'enqueueBulkComposite').mockResolvedValue({
      batchId: '22222222-2222-4222-8222-222222222222',
      status: 'queued',
      senderCount: 0,
      requestedTotal: 0,
      wakeAt: null,
      skipped: [
        { senderId, reason: 'mailto' },
        { senderId: other!.id, reason: 'no_channel' },
        { senderId: unknown!.id, reason: 'unknown' },
      ],
    });
    const result = await svc.confirm({
      mailboxAccountId: mailboxId,
      idempotencyKey: 'skip-codes-1',
      mode: 'archive',
      senderIds: [senderId, other!.id, unknown!.id],
    });
    expect(result.senders.find((row) => row.senderId === senderId)).toMatchObject({
      unsubStatus: 'skipped',
      reasonCode: 'mailto_only',
    });
    expect(result.senders.find((row) => row.senderId === other!.id)).toMatchObject({
      unsubStatus: 'skipped',
      reasonCode: 'no_link',
    });
    expect(result.senders.find((row) => row.senderId === unknown!.id)).toMatchObject({
      unsubStatus: 'skipped',
      reasonCode: 'method_unknown',
    });
    expect(result.senders.map((row) => row.reasonCode)).not.toContain('not_found');
  });

  it('undo reverses the backlog only', async () => {
    await seedInbox(db, mailboxId, 2);
    const result = await svc.confirm({
      mailboxAccountId: mailboxId,
      idempotencyKey: 'undo-key-1',
      mode: 'archive',
      senderIds: [senderId],
    });
    const [undo] = await db
      .insert(undoJournal)
      .values({
        mailboxAccountId: mailboxId,
        actionKind: 'archive',
        payload: { kind: 'archive', messageIds: ['m-0'], priorLabels: ['INBOX'] },
      })
      .returning({ token: undoJournal.token });
    await db
      .update(actionJobs)
      .set({ undoToken: undo!.token, status: 'done', affectedCount: 2 })
      .where(eq(actionJobs.id, result.backlog!.actionId));

    const handles = await actions.enqueueCompositeRevert({
      mailboxAccountId: mailboxId,
      token: undo!.token,
    });
    expect(handles).toHaveLength(1);
    const reverse = await db
      .select({ verb: actionJobs.verb, direction: actionJobs.direction })
      .from(actionJobs)
      .where(eq(actionJobs.direction, 'reverse'));
    expect(reverse.map((row) => row.verb)).toEqual(['archive']);
  });
});
