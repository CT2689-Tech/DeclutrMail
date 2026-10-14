import { randomUUID } from 'node:crypto';

import type { schema } from '@declutrmail/db';
import {
  actionJobs,
  activityLog,
  inboxReportCache,
  mailMessages,
  mailboxAccounts,
  senders,
  senderPolicies,
  undoJournal,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EntitlementsService } from '../common/entitlements/entitlements.service.js';
import { ActionsService } from '../actions/actions.service.js';
import { UnsubscribeBacklogService } from '../actions/unsubscribe-backlog.service.js';
import { InboxReportService } from './inbox-report.service.js';
import { SendersPolicyService } from '../senders/senders-policy.service.js';

type Db = ReturnType<typeof drizzle<typeof schema>>;

const NOW = new Date('2026-10-11T12:00:00.000Z');

function fakeQueue() {
  const seen = new Set<string>();
  return {
    add: async (_job: unknown, _data: unknown, opts: { jobId?: string }) => {
      if (opts?.jobId && opts.jobId.includes(':')) {
        throw new Error('Custom Id cannot contain :');
      }
      if (opts?.jobId && seen.has(opts.jobId)) return;
      if (opts?.jobId) seen.add(opts.jobId);
    },
    getJob: async () => null,
  };
}

async function seedMailbox(db: Db): Promise<string> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Report backlog' })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: `report-${randomUUID()}@declutrmail.test` })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: `report-${randomUUID()}@gmail.test`,
    })
    .returning({ id: mailboxAccounts.id });
  return mailbox!.id;
}

async function seedSender(
  db: Db,
  mailboxId: string,
  senderKey: string,
  email: string,
  messages: number,
): Promise<string> {
  const [row] = await db
    .insert(senders)
    .values({
      mailboxAccountId: mailboxId,
      senderKey,
      email,
      domain: 'news.test',
      gmailCategory: 'promotions',
      firstSeenAt: new Date('2026-09-01T00:00:00.000Z'),
      lastSeenAt: NOW,
      unsubscribeMethod: 'one_click',
      unsubscribeUrl: `https://news.test/${email}`,
    })
    .returning({ id: senders.id });
  for (let i = 0; i < messages; i += 1) {
    await db.insert(mailMessages).values({
      mailboxAccountId: mailboxId,
      providerMessageId: `${email}-${i}`,
      providerThreadId: `${email}-t-${i}`,
      senderKey,
      internalDate: new Date('2026-10-01T00:00:00.000Z'),
      isUnread: true,
      labelIds: ['INBOX'],
      isOutbound: false,
      sizeBytes: 1000,
    });
  }
  return row!.id;
}

describe('inbox report fix set after sender decisions', () => {
  let db: Db;
  let report: InboxReportService;
  let backlog: UnsubscribeBacklogService;

  beforeAll(() => {
    process.env.UNSUB_SEND_ENABLED = 'true';
  });

  beforeEach(async () => {
    db = await freshTestDb();
    report = new InboxReportService(db as never);
    const actions = new ActionsService(
      db as never,
      fakeQueue() as never,
      undefined,
      fakeQueue() as never,
    );
    backlog = new UnsubscribeBacklogService(
      actions,
      new EntitlementsService(db as never),
      db as never,
    );
    delete process.env.METER_V2;
  });

  afterEach(() => {
    process.env.UNSUB_SEND_ENABLED = 'true';
    delete process.env.METER_V2;
  });

  // Normalize audit timestamps to the report fixture clock after the real
  // writer runs. The policy touch trigger retains the database clock.
  async function policyClock(mailboxId: string, seconds: number) {
    const at = new Date(NOW.getTime() + seconds * 1000);
    await db
      .update(activityLog)
      .set({ occurredAt: at, createdAt: at })
      .where(eq(activityLog.mailboxAccountId, mailboxId));
  }

  it('refreshes the cached fix after Keep without another mailbox sync', async () => {
    const mailboxId = await seedMailbox(db);
    const alpha = await seedSender(db, mailboxId, 'a'.repeat(64), 'alpha@news.test', 4);
    const calm = await seedSender(db, mailboxId, 'c'.repeat(64), 'calm@news.test', 3);
    const policies = new SendersPolicyService(db as never);
    expect((await report.getForMailbox(mailboxId, NOW)).fix.senderKeys).toEqual([alpha, calm]);

    await policies.setPolicy({
      mailboxAccountId: mailboxId,
      senderId: alpha,
      patch: { policyType: 'keep' },
    });
    await policyClock(mailboxId, 1);
    const after = await report.getForMailbox(mailboxId, new Date(NOW.getTime() + 2000));
    expect(after.fix.senderKeys).toEqual([calm]);
    expect(after.fix.sendersCount).toBe(1);
    expect(after.fix.inboxEmailCount).toBe(3);
  });

  it('Undo Keep restores a cached fix set and leaves another mailbox cache alone', async () => {
    const mailboxId = await seedMailbox(db);
    const otherId = await seedMailbox(db);
    const alpha = await seedSender(db, mailboxId, 'a'.repeat(64), 'alpha@news.test', 4);
    const calm = await seedSender(db, mailboxId, 'c'.repeat(64), 'calm@news.test', 3);
    const other = await seedSender(db, otherId, 'a'.repeat(64), 'other@news.test', 5);
    const otherReport = await report.getForMailbox(otherId, NOW);
    const policies = new SendersPolicyService(db as never);
    await policies.setPolicy({
      mailboxAccountId: mailboxId,
      senderId: alpha,
      patch: { policyType: 'keep' },
    });
    await policyClock(mailboxId, 1);
    const cached = await report.getForMailbox(mailboxId, new Date(NOW.getTime() + 2000));
    expect(cached.fix.senderKeys).toEqual([calm]);

    await policies.undoKeep({ mailboxAccountId: mailboxId, senderId: alpha });
    await db
      .update(activityLog)
      .set({ revertedAt: new Date(NOW.getTime() + 3000) })
      .where(eq(activityLog.mailboxAccountId, mailboxId));
    const restored = await report.getForMailbox(mailboxId, new Date(NOW.getTime() + 4000));
    expect(restored.fix.senderKeys).toEqual([alpha, calm]);
    expect(restored.fix.sendersCount).toBe(2);
    expect(restored.fix.inboxEmailCount).toBe(7);
    const [stored] = await db
      .select()
      .from(inboxReportCache)
      .where(eq(inboxReportCache.mailboxAccountId, mailboxId));
    expect(stored!.sourceSyncRunId).toBeNull();
    expect(await report.getForMailbox(otherId, new Date(NOW.getTime() + 4000))).toEqual(
      otherReport,
    );
    expect(otherReport.fix.senderKeys).toEqual([other]);
  });

  it('Protect and Unprotect refresh cached eligibility without changing the standing verdict', async () => {
    const mailboxId = await seedMailbox(db);
    const alpha = await seedSender(db, mailboxId, 'a'.repeat(64), 'alpha@news.test', 4);
    const calm = await seedSender(db, mailboxId, 'c'.repeat(64), 'calm@news.test', 3);
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: 'a'.repeat(64),
      policyType: 'unsubscribe',
      updatedAt: NOW,
    });
    const policies = new SendersPolicyService(db as never);
    expect((await report.getForMailbox(mailboxId, NOW)).fix.senderKeys).toEqual([alpha, calm]);

    await policies.setPolicy({
      mailboxAccountId: mailboxId,
      senderId: alpha,
      patch: { isProtected: true },
    });
    await policyClock(mailboxId, 1);
    expect(
      (await report.getForMailbox(mailboxId, new Date(NOW.getTime() + 2000))).fix.senderKeys,
    ).toEqual([calm]);
    await policies.setPolicy({
      mailboxAccountId: mailboxId,
      senderId: alpha,
      patch: { isProtected: false },
    });
    await policyClock(mailboxId, 3);
    const restored = await report.getForMailbox(mailboxId, new Date(NOW.getTime() + 4000));
    expect(restored.fix.senderKeys).toEqual([alpha, calm]);
    const [policy] = await db
      .select()
      .from(senderPolicies)
      .where(eq(senderPolicies.mailboxAccountId, mailboxId));
    expect(policy!.policyType).toBe('unsubscribe');
    expect(policy!.isProtected).toBe(false);
    // A snapshot newer than the database's policy timestamp stays cached;
    // the fix must not turn every report read into a recomputation.
    const settledAt = new Date(policy!.updatedAt.getTime() + 1000);
    const settled = await report.getForMailbox(mailboxId, settledAt);
    const unchanged = await report.getForMailbox(mailboxId, new Date(settledAt.getTime() + 1000));
    expect(unchanged.generatedAt).toBe(settled.generatedAt);
  });

  it('confirm drops the senders, the Undo window keeps them out, and Undo brings them back', async () => {
    const mailboxId = await seedMailbox(db);
    const alpha = await seedSender(db, mailboxId, 'a'.repeat(64), 'alpha@news.test', 5);
    const beta = await seedSender(db, mailboxId, 'b'.repeat(64), 'beta@news.test', 4);
    const calm = await seedSender(db, mailboxId, 'c'.repeat(64), 'calm@news.test', 3);

    const before = await report.getForMailbox(mailboxId, NOW);
    expect(before.fix.senderKeys).toEqual([alpha, beta, calm]);
    expect(before.fix.sendersCount).toBe(3);
    expect(before.fix.inboxEmailCount).toBe(12);
    expect(before.fallbackSenderCount).toBe(3);

    await backlog.confirm({
      mailboxAccountId: mailboxId,
      idempotencyKey: 'fix-set-1',
      mode: 'archive',
      senderIds: [alpha, beta],
    });
    expect(
      await db
        .select()
        .from(inboxReportCache)
        .where(eq(inboxReportCache.mailboxAccountId, mailboxId)),
    ).toEqual([]);
    // Confirm stamps jobs with the database clock, which is after NOW.
    // Pin them so this reload is not a miss just because updated_at is newer.
    await db.update(actionJobs).set({ updatedAt: NOW });

    const afterConfirm = await report.getForMailbox(mailboxId, NOW);
    expect(afterConfirm.fix.senderKeys).toEqual([calm]);
    expect(afterConfirm.fix.sendersCount).toBe(1);
    expect(afterConfirm.fix.inboxEmailCount).toBe(3);
    expect(afterConfirm.fallbackSenderCount).toBe(1);

    const moves = await db
      .select({ id: actionJobs.id })
      .from(actionJobs)
      .where(eq(actionJobs.verb, 'archive'));
    expect(moves).toHaveLength(2);
    for (const move of moves) {
      const [undo] = await db
        .insert(undoJournal)
        .values({
          mailboxAccountId: mailboxId,
          actionKind: 'archive',
          payload: { kind: 'archive', messageIds: [] },
        })
        .returning({ token: undoJournal.token });
      await db
        .update(actionJobs)
        .set({ undoToken: undo!.token, status: 'done', affectedCount: 1, updatedAt: new Date() })
        .where(eq(actionJobs.id, move.id));
    }

    const duringUndo = await report.getForMailbox(mailboxId, NOW);
    expect(duringUndo.fix.senderKeys).toEqual([calm]);
    expect(duringUndo.fix.sendersCount).toBe(1);
    expect(duringUndo.fix.inboxEmailCount).toBe(3);

    await db.update(undoJournal).set({ revertedAt: new Date() });

    const afterUndo = await report.getForMailbox(mailboxId, NOW);
    expect(afterUndo.fix.senderKeys).toEqual([alpha, beta, calm]);
    expect(afterUndo.fix.sendersCount).toBe(3);
    expect(afterUndo.fix.inboxEmailCount).toBe(12);
    expect(afterUndo.fallbackSenderCount).toBe(3);
  });

  it('brings a sender back when Undo is recorded only on the activity row', async () => {
    const mailboxId = await seedMailbox(db);
    const alpha = await seedSender(db, mailboxId, 'a'.repeat(64), 'alpha@news.test', 4);
    await seedSender(db, mailboxId, 'c'.repeat(64), 'calm@news.test', 3);
    await backlog.confirm({
      mailboxAccountId: mailboxId,
      idempotencyKey: 'activity-undo-1',
      mode: 'archive',
      senderIds: [alpha],
    });
    expect((await report.getForMailbox(mailboxId, NOW)).fix.senderKeys).not.toContain(alpha);

    const [move] = await db
      .select({ id: actionJobs.id })
      .from(actionJobs)
      .where(eq(actionJobs.verb, 'archive'));
    await db.insert(activityLog).values({
      mailboxAccountId: mailboxId,
      senderKey: 'a'.repeat(64),
      source: 'manual',
      action: 'archive',
      affectedCount: 4,
      actionJobId: move!.id,
      revertedAt: new Date(),
    });

    const after = await report.getForMailbox(mailboxId, NOW);
    expect(after.fix.senderKeys).toContain(alpha);
    expect(after.fix.sendersCount).toBe(2);
    expect(after.fix.inboxEmailCount).toBe(7);
  });

  it('drops a handled sender from a cache row written after the jobs', async () => {
    const mailboxId = await seedMailbox(db);
    const alpha = await seedSender(db, mailboxId, 'a'.repeat(64), 'alpha@news.test', 4);
    const calm = await seedSender(db, mailboxId, 'c'.repeat(64), 'calm@news.test', 3);
    const stale = await report.getForMailbox(mailboxId, NOW);
    expect(stale.fix.senderKeys).toEqual([alpha, calm]);

    await backlog.confirm({
      mailboxAccountId: mailboxId,
      idempotencyKey: 'stale-cache-1',
      mode: 'archive',
      senderIds: [alpha],
    });
    await db.update(actionJobs).set({ updatedAt: NOW });
    const generatedAt = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    await db
      .insert(inboxReportCache)
      .values({
        mailboxAccountId: mailboxId,
        payload: stale,
        sourceSyncRunId: null,
        generatedAt,
      })
      .onConflictDoUpdate({
        target: inboxReportCache.mailboxAccountId,
        set: { payload: stale, sourceSyncRunId: null, generatedAt },
      });

    const after = await report.getForMailbox(mailboxId, generatedAt);
    expect(after.fix.senderKeys).toEqual([calm]);
    expect(after.fix.sendersCount).toBe(1);
    expect(after.fix.inboxEmailCount).toBe(3);
    expect(after.fallbackSenderCount).toBe(1);
  });

  it('keeps a sender archived outside unsubscribe-backlog in the fix set', async () => {
    const mailboxId = await seedMailbox(db);
    const alpha = await seedSender(db, mailboxId, 'a'.repeat(64), 'alpha@news.test', 4);
    await db.insert(actionJobs).values({
      mailboxAccountId: mailboxId,
      verb: 'archive',
      direction: 'forward',
      selector: { type: 'sender', senderId: alpha, senderKey: 'a'.repeat(64) },
      requestedCount: 4,
      affectedCount: 4,
      status: 'done',
      idempotencyKey: 'triage-archive-1',
    });

    const result = await report.getForMailbox(mailboxId, NOW);
    expect(result.fix.senderKeys).toEqual([alpha]);
    expect(result.fix.sendersCount).toBe(1);
    expect(result.fix.inboxEmailCount).toBe(4);
  });
});
