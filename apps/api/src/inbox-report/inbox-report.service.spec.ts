import { randomUUID } from 'node:crypto';

import type { schema } from '@declutrmail/db';
import {
  inboxReportCache,
  invalidateInboxReportCache,
  mailMessages,
  mailboxAccounts,
  senders,
  syncRuns,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { InboxReportService } from './inbox-report.service.js';

type Db = ReturnType<typeof drizzle<typeof schema>>;

const NOW = new Date('2026-10-11T12:00:00.000Z');

async function seedMailbox(db: Db): Promise<{ mailboxId: string; workspaceId: string }> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Report' })
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
  return { mailboxId: mailbox!.id, workspaceId: ws!.id };
}

describe('InboxReportService', () => {
  let db: Db;
  let service: InboxReportService;

  beforeAll(async () => {
    db = await freshTestDb();
    service = new InboxReportService(db as never);
  });

  it('drops pre-1995 mail, ignores a 2-email sender, and fixes the 3-email sender', async () => {
    const { mailboxId, workspaceId } = await seedMailbox(db);
    const [quiet] = await db
      .insert(senders)
      .values({
        mailboxAccountId: mailboxId,
        senderKey: 'a'.repeat(64),
        email: 'quiet@news.test',
        domain: 'news.test',
        gmailCategory: 'promotions',
        firstSeenAt: new Date('2026-09-01'),
        lastSeenAt: NOW,
        unsubscribeMethod: 'one_click',
        unsubscribeUrl: 'https://news.test/unsub',
      })
      .returning({ id: senders.id });
    await db.insert(senders).values({
      mailboxAccountId: mailboxId,
      senderKey: 'b'.repeat(64),
      email: 'small@news.test',
      domain: 'news.test',
      gmailCategory: 'promotions',
      firstSeenAt: new Date('2026-09-01'),
      lastSeenAt: NOW,
      unsubscribeMethod: 'one_click',
      unsubscribeUrl: 'https://news.test/small',
    });
    for (let i = 0; i < 3; i += 1) {
      await db.insert(mailMessages).values({
        mailboxAccountId: mailboxId,
        providerMessageId: `quiet-${i}`,
        providerThreadId: `quiet-t-${i}`,
        senderKey: 'a'.repeat(64),
        internalDate: new Date('2026-10-01T00:00:00.000Z'),
        isUnread: true,
        labelIds: ['INBOX'],
        isOutbound: false,
        sizeBytes: 1000,
      });
    }
    for (let i = 0; i < 2; i += 1) {
      await db.insert(mailMessages).values({
        mailboxAccountId: mailboxId,
        providerMessageId: `small-${i}`,
        providerThreadId: `small-t-${i}`,
        senderKey: 'b'.repeat(64),
        internalDate: new Date('2026-10-01T00:00:00.000Z'),
        isUnread: true,
        labelIds: ['INBOX'],
        isOutbound: false,
      });
    }
    await db.insert(mailMessages).values({
      mailboxAccountId: mailboxId,
      providerMessageId: 'ancient',
      providerThreadId: 'ancient-t',
      senderKey: 'a'.repeat(64),
      internalDate: new Date('1990-01-01T00:00:00.000Z'),
      isUnread: true,
      labelIds: ['INBOX'],
      isOutbound: false,
    });

    const report = await service.getForMailbox(mailboxId, NOW);
    expect(report.receivedCount).toBe(5);
    expect(report.fix.senderKeys).toEqual([quiet!.id]);
    // The 1990 row is out of the report facts and still in Inbox, so Archive would move it.
    expect(report.fix.inboxEmailCount).toBe(4);
    expect(report.insights.some((insight) => insight.id === 'mostly_unread_share')).toBe(true);

    await db.insert(mailMessages).values({
      mailboxAccountId: mailboxId,
      providerMessageId: 'after-cache',
      providerThreadId: 'after-cache-t',
      senderKey: 'b'.repeat(64),
      internalDate: new Date('2026-10-02T00:00:00.000Z'),
      isUnread: true,
      labelIds: ['INBOX'],
      isOutbound: false,
    });
    const cached = await service.getForMailbox(mailboxId, NOW);
    expect(cached.receivedCount).toBe(5);

    await db.insert(syncRuns).values({ mailboxAccountId: mailboxId, status: 'succeeded' });
    const refreshed = await service.getForMailbox(mailboxId, NOW);
    expect(refreshed.receivedCount).toBe(6);

    await expect(
      service.assertInWorkspace('00000000-0000-0000-0000-000000000000', mailboxId),
    ).rejects.toThrow();
    await expect(service.assertInWorkspace(workspaceId, mailboxId)).resolves.toBeUndefined();
  });

  it('runs one compute when two cache misses overlap', async () => {
    const { mailboxId } = await seedMailbox(db);
    const execute = vi.spyOn(db, 'execute');
    const [left, right] = await Promise.all([
      service.getForMailbox(mailboxId, NOW),
      service.getForMailbox(mailboxId, NOW),
    ]);
    expect(left).toEqual(right);
    const duringMiss = execute.mock.calls.length;
    expect(duringMiss).toBeGreaterThan(0);
    execute.mockClear();
    await service.getForMailbox(mailboxId, NOW);
    // The hit still checks backlog timestamps and whether a cached fix sender is handled.
    expect(execute).toHaveBeenCalledTimes(1);
    // A second overlapping miss that did not join the first would have
    // doubled the fact queries. One compute is three executes.
    expect(duringMiss).toBe(3);
  });

  it('recomputes after the cache row is deleted, with no new sync run', async () => {
    const { mailboxId } = await seedMailbox(db);
    await db.insert(mailMessages).values({
      mailboxAccountId: mailboxId,
      providerMessageId: 'live-1',
      providerThreadId: 'live-t-1',
      senderKey: 'c'.repeat(64),
      internalDate: new Date('2026-10-01T00:00:00.000Z'),
      isUnread: true,
      labelIds: ['INBOX'],
      isOutbound: false,
    });
    const first = await service.getForMailbox(mailboxId, NOW);
    expect(first.receivedCount).toBe(1);
    await db.insert(mailMessages).values({
      mailboxAccountId: mailboxId,
      providerMessageId: 'live-2',
      providerThreadId: 'live-t-2',
      senderKey: 'c'.repeat(64),
      internalDate: new Date('2026-10-02T00:00:00.000Z'),
      isUnread: true,
      labelIds: ['INBOX'],
      isOutbound: false,
    });
    expect((await service.getForMailbox(mailboxId, NOW)).receivedCount).toBe(1);
    await invalidateInboxReportCache(db, mailboxId);
    expect(
      await db
        .select()
        .from(inboxReportCache)
        .where(eq(inboxReportCache.mailboxAccountId, mailboxId)),
    ).toEqual([]);
    expect((await service.getForMailbox(mailboxId, NOW)).receivedCount).toBe(2);
  });
});
