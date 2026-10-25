import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { freshTestDb } from '@declutrmail/db/testing';
import { mailboxAccounts, mailMessages, users, workspaces } from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { MailboxSnapshotSchema } from '@declutrmail/shared/inbox-report';
import { InboxReportService } from './inbox-report.service.js';

describe('mailbox-wide snapshot', () => {
  it('counts every scanned inbound row in one mailbox and refreshes after a label change', async () => {
    const db = await freshTestDb();
    const [ws] = await db.insert(workspaces).values({ name: 'Snapshot' }).returning();
    const [user] = await db
      .insert(users)
      .values({ workspaceId: ws!.id, email: `${randomUUID()}@synthetic.test` })
      .returning();
    const [mailbox, other] = await db
      .insert(mailboxAccounts)
      .values(
        ['a', 'b'].map((id) => ({
          workspaceId: ws!.id,
          userId: user!.id,
          provider: 'gmail' as const,
          providerAccountId: `${id}@synthetic.test`,
        })),
      )
      .returning();
    await db.insert(mailMessages).values(
      Array.from({ length: 60 }, (_, i) => ({
        mailboxAccountId: mailbox!.id,
        providerMessageId: `in-${i}`,
        providerThreadId: `t-${i}`,
        senderKey: 'a'.repeat(64),
        internalDate: new Date('1990-01-01'),
        isUnread: i < 40,
        labelIds: ['INBOX'],
        isOutbound: false,
        sizeBytes: i < 30 ? 100 : null,
      })),
    );
    await db.insert(mailMessages).values([
      {
        mailboxAccountId: mailbox!.id,
        providerMessageId: 'archive',
        providerThreadId: 'arch',
        senderKey: 'a'.repeat(64),
        internalDate: new Date(),
        isUnread: true,
        labelIds: [],
        isOutbound: false,
        sizeBytes: 200,
      },
      {
        mailboxAccountId: mailbox!.id,
        providerMessageId: 'trash',
        providerThreadId: 'trash',
        senderKey: 'a'.repeat(64),
        internalDate: new Date(),
        isUnread: true,
        labelIds: ['INBOX', 'TRASH'],
        isOutbound: false,
        sizeBytes: 300,
      },
      {
        mailboxAccountId: mailbox!.id,
        providerMessageId: 'sent',
        providerThreadId: 'sent',
        senderKey: 'a'.repeat(64),
        internalDate: new Date(),
        isUnread: true,
        labelIds: ['SENT'],
        isOutbound: true,
        sizeBytes: 9999,
      },
      {
        mailboxAccountId: other!.id,
        providerMessageId: 'other',
        providerThreadId: 'other',
        senderKey: 'b'.repeat(64),
        internalDate: new Date(),
        isUnread: true,
        labelIds: ['INBOX'],
        isOutbound: false,
        sizeBytes: 9999,
      },
    ]);
    const service = new InboxReportService(db as never);
    const now = new Date('2026-10-25T20:00:00Z');
    expect(MailboxSnapshotSchema.parse(await service.getSnapshot(mailbox!.id, now))).toEqual({
      asOf: now.toISOString(),
      inboxCount: 60,
      unreadInboxCount: 40,
      receivedCount: 62,
      totalBytes: 3500,
      sizeKnownCount: 32,
    });
    await db
      .update(mailMessages)
      .set({ labelIds: [] })
      .where(eq(mailMessages.mailboxAccountId, mailbox!.id));
    expect(await service.getSnapshot(mailbox!.id, now)).toMatchObject({
      inboxCount: 0,
      unreadInboxCount: 0,
      receivedCount: 62,
    });
    const [empty] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: ws!.id,
        userId: user!.id,
        provider: 'gmail',
        providerAccountId: 'empty@synthetic.test',
      })
      .returning();
    expect(await service.getSnapshot(empty!.id, now)).toMatchObject({
      receivedCount: 0,
      totalBytes: null,
      sizeKnownCount: 0,
    });
    await expect(service.assertInWorkspace(randomUUID(), mailbox!.id)).rejects.toThrow();
  });
});
