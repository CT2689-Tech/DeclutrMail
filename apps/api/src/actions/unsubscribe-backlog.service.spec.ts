import {
  actionJobs,
  mailMessages,
  mailboxAccounts,
  schema,
  senders,
  undoJournal,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
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
    expect(labelQueue.count).toBe(1);
    expect(unsubQueue.count).toBe(1);
    const [unsub] = await db
      .select({ compositeId: actionJobs.compositeId })
      .from(actionJobs)
      .where(eq(actionJobs.idempotencyKey, `unsub:order-key-1-${senderId}`));
    expect(unsub?.compositeId).toBe(result.backlog?.actionId);
    expect(await entitlements.cleanupUnitsUsed(workspaceId)).toBe(1);
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
    expect(result.senders[0]?.reasonCode).toBe('generic');
    expect(labelQueue.count).toBe(1);
    expect(unsubQueue.count).toBe(0);
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
