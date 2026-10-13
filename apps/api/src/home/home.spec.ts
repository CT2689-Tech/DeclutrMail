import { beforeEach, describe, expect, it } from 'vitest';
import { freshTestDb } from '@declutrmail/db/testing';
import {
  mailboxAccounts,
  mailboxDataDeletionRequests,
  mailMessages,
  senderPolicies,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import type { DrizzleDb } from '../db/db.module.js';
import { UsersService } from '../users/users.service.js';
import { MailboxAccountsService } from '../mailboxes/mailbox-accounts.service.js';
import { SendersReadService } from '../senders/senders.read-service.js';

describe('returning visit and scan discovery', () => {
  let db: DrizzleDb;
  let visits: UsersService;
  let reads: SendersReadService;
  let mailboxes: MailboxAccountsService;
  let userId: string;
  let inboxA: string;
  let inboxB: string;
  const first = '10000000-0000-4000-8000-000000000001';
  const second = '10000000-0000-4000-8000-000000000002';
  const start = new Date('2026-10-10T10:00:00Z');
  const finish = new Date('2026-10-10T11:00:00Z');

  beforeEach(async () => {
    db = (await freshTestDb()) as unknown as DrizzleDb;
    visits = new UsersService(db);
    reads = new SendersReadService(db);
    mailboxes = new MailboxAccountsService(db, null!, null!, null!);
    const [workspace] = await db.insert(workspaces).values({ name: 'Journey test' }).returning();
    const [user] = await db
      .insert(users)
      .values({
        email: 'journey@example.test',
        workspaceId: workspace!.id,
        preferences: { emailPrefs: { reminders: false } },
      })
      .returning();
    userId = user!.id;
    const boxes = await db
      .insert(mailboxAccounts)
      .values(
        ['a', 'b'].map((name) => ({
          workspaceId: workspace!.id,
          userId,
          provider: 'gmail' as const,
          providerAccountId: `${name}@example.test`,
        })),
      )
      .returning();
    inboxA = boxes[0]!.id;
    inboxB = boxes[1]!.id;
  });

  async function sender(mailboxId: string, key: string, at: Date) {
    const [row] = await db
      .insert(senders)
      .values({
        mailboxAccountId: mailboxId,
        senderKey: key,
        email: `${key}@example.test`,
        domain: 'example.test',
        gmailCategory: 'unknown',
        firstSeenAt: at,
        lastSeenAt: at,
        createdAt: at,
        firstIndexedAt: at,
      })
      .returning();
    return row!;
  }
  async function message(
    mailboxId: string,
    key: string,
    id: string,
    at: Date,
    labels = ['INBOX'],
    outbound = false,
  ) {
    await db.insert(mailMessages).values({
      mailboxAccountId: mailboxId,
      senderKey: key,
      providerMessageId: id,
      providerThreadId: id,
      internalDate: new Date('2020-01-01'),
      createdAt: at,
      labelIds: labels,
      isUnread: true,
      isOutbound: outbound,
    });
  }

  it('keeps repeated visit boundaries, separates inboxes, and preserves unrelated preferences', async () => {
    const initial = await visits.recordMailboxVisit(
      userId,
      inboxA,
      first,
      reads.indexedArrivals.bind(reads, inboxA),
      (executor) => mailboxes.assertVisitEligible(userId, inboxA, executor),
      start,
    );
    expect(initial.since).toBeNull();
    const next = await visits.recordMailboxVisit(
      userId,
      inboxA,
      second,
      reads.indexedArrivals.bind(reads, inboxA),
      (executor) => mailboxes.assertVisitEligible(userId, inboxA, executor),
      finish,
    );
    expect(next).toEqual({
      visitId: second,
      since: start.toISOString(),
      until: finish.toISOString(),
      indexedEmails: 0,
      indexedSenders: 0,
    });
    expect(
      await visits.recordMailboxVisit(
        userId,
        inboxA,
        second,
        reads.indexedArrivals.bind(reads, inboxA),
        (executor) => mailboxes.assertVisitEligible(userId, inboxA, executor),
        new Date('2026-10-12'),
      ),
    ).toEqual(next);
    expect(
      (
        await visits.recordMailboxVisit(
          userId,
          inboxB,
          second,
          reads.indexedArrivals.bind(reads, inboxB),
          (executor) => mailboxes.assertVisitEligible(userId, inboxB, executor),
          finish,
        )
      ).since,
    ).toBeNull();
    expect(
      ((await visits.findById(userId))!.preferences as Record<string, unknown>).emailPrefs,
    ).toEqual({ reminders: false });
    const peek = await visits.peekMailboxVisit(
      userId,
      inboxA,
      first,
      reads.indexedArrivals.bind(reads, inboxA),
      (executor) => mailboxes.assertVisitEligible(userId, inboxA, executor),
      finish,
    );
    expect(peek).toEqual(initial);
    const open = await visits.peekMailboxVisit(
      userId,
      inboxA,
      undefined,
      reads.indexedArrivals.bind(reads, inboxA),
      (executor) => mailboxes.assertVisitEligible(userId, inboxA, executor),
      finish,
    );
    const unknown = await visits.peekMailboxVisit(
      userId,
      inboxA,
      '10000000-0000-4000-8000-000000000099',
      reads.indexedArrivals.bind(reads, inboxA),
      (executor) => mailboxes.assertVisitEligible(userId, inboxA, executor),
      finish,
    );
    expect(unknown.visitId).toBe('10000000-0000-4000-8000-000000000099');
    expect(unknown.since).toBe(next.until);
    expect(open.since).toBe(next.until);
    expect(
      ((await visits.findById(userId))!.preferences as { mailboxVisits: Record<string, unknown> })
        .mailboxVisits[inboxA],
    ).toHaveLength(2);
  });

  it('counts newly indexed rows, uses exact visit boundaries, and excludes another inbox and outbound', async () => {
    await sender(inboxA, 'old', start);
    await sender(inboxA, 'new', new Date('2026-10-10T10:30:00Z'));
    await sender(inboxA, 'future', new Date('2026-10-10T12:00:00Z'));
    await sender(inboxB, 'other', finish);
    await message(inboxA, 'old', 'boundary', start);
    await message(inboxA, 'new', 'new', finish);
    await message(inboxA, 'future', 'future', new Date('2026-10-10T12:00:00Z'));
    await message(inboxA, 'new', 'outbound', finish, ['SENT'], true);
    await message(inboxB, 'other', 'other', finish);
    expect(await reads.indexedArrivals(inboxA, start, finish)).toEqual({
      indexedEmails: 1,
      indexedSenders: 1,
    });
  });

  it('freezes counts across reload, deletion, and sender rebuild', async () => {
    await visits.recordMailboxVisit(
      userId,
      inboxA,
      first,
      reads.indexedArrivals.bind(reads, inboxA),
      (executor) => mailboxes.assertVisitEligible(userId, inboxA, executor),
      start,
    );
    await sender(inboxA, 'old', start);
    await message(inboxA, 'old', 'old', start);
    await message(inboxA, 'old', 'arrival', finish);
    await sender(inboxA, 'new', finish);
    await message(inboxA, 'new', 'new', finish);
    // Removing the old message must not turn a continuously indexed sender new.
    await db.delete(mailMessages).where(eq(mailMessages.providerMessageId, 'old'));
    // Rebuilding sender rows changes generation but must not make old senders new.
    await db.update(senders).set({ createdAt: finish }).where(eq(senders.mailboxAccountId, inboxA));
    const snapshot = await visits.recordMailboxVisit(
      userId,
      inboxA,
      second,
      reads.indexedArrivals.bind(reads, inboxA),
      (executor) => mailboxes.assertVisitEligible(userId, inboxA, executor),
      finish,
    );
    expect(snapshot).toMatchObject({ indexedEmails: 2, indexedSenders: 1 });
    await db.delete(mailMessages).where(eq(mailMessages.mailboxAccountId, inboxA));
    expect(
      await visits.recordMailboxVisit(
        userId,
        inboxA,
        second,
        reads.indexedArrivals.bind(reads, inboxA),
        (executor) => mailboxes.assertVisitEligible(userId, inboxA, executor),
        new Date('2026-10-12'),
      ),
    ).toEqual(snapshot);
  });

  it('previews actual stored batches and chooses biggest eligible inbox backlog, excluding Protected and archived mail', async () => {
    const protectedSender = await sender(inboxA, 'protected', start);
    const best = await sender(inboxA, 'eligible', start);
    await sender(inboxA, 'archived', start);
    await sender(inboxB, 'other', start);
    await db.insert(senderPolicies).values({
      mailboxAccountId: inboxA,
      senderKey: protectedSender.senderKey,
      isProtected: true,
      protectionReason: 'starred',
    });
    for (let i = 0; i < 4; i++) await message(inboxA, 'protected', `protected-${i}`, start);
    for (let i = 0; i < 2; i++) await message(inboxA, 'eligible', `eligible-${i}`, start);
    for (let i = 0; i < 8; i++) await message(inboxA, 'archived', `archive-${i}`, start, []);
    await message(inboxB, 'other', 'other', start);
    expect(await reads.firstBacklog(inboxA)).toEqual({
      senderId: best.id,
      name: 'eligible@example.test',
      inboxEmails: 2,
    });
    const preview = await reads.scanPreview(inboxA);
    expect(preview.map((row) => row.indexedEmails)).toEqual([8, 4, 2]);
    expect(preview).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'other@example.test' })]),
    );
    expect(Object.keys(preview[0]!)).toEqual(['name', 'indexedEmails']);
  });

  it('rejects a visit whose guard passed before mailbox purge', async () => {
    await visits.recordMailboxVisit(
      userId,
      inboxA,
      first,
      reads.indexedArrivals.bind(reads, inboxA),
      (executor) => mailboxes.assertVisitEligible(userId, inboxA, executor),
      start,
    );
    await db
      .update(mailboxAccounts)
      .set({ status: 'disconnected' })
      .where(eq(mailboxAccounts.id, inboxA));
    await db
      .update(users)
      .set({ preferences: { mailboxVisits: {} } })
      .where(eq(users.id, userId));
    await expect(
      visits.recordMailboxVisit(
        userId,
        inboxA,
        second,
        reads.indexedArrivals.bind(reads, inboxA),
        (executor) => mailboxes.assertVisitEligible(userId, inboxA, executor),
        finish,
      ),
    ).rejects.toMatchObject({ response: { code: 'NO_ACTIVE_MAILBOX' } });
    expect((await visits.findById(userId))!.preferences).toEqual({ mailboxVisits: {} });
  });
  it.each(['pending', 'executing', 'failed'] as const)(
    'does not persist snapshots during %s indexed-data deletion',
    async (status) => {
      await db.insert(mailboxDataDeletionRequests).values({ mailboxAccountId: inboxA, status });
      await expect(
        visits.recordMailboxVisit(
          userId,
          inboxA,
          first,
          reads.indexedArrivals.bind(reads, inboxA),
          (executor) => mailboxes.assertVisitEligible(userId, inboxA, executor),
          start,
        ),
      ).rejects.toMatchObject({ response: { code: 'MAILBOX_DATA_DELETION_IN_PROGRESS' } });
      expect((await visits.findById(userId))!.preferences).toEqual({
        emailPrefs: { reminders: false },
      });
    },
  );

  it('repairs malformed visit preferences and never regresses a boundary after a clock change', async () => {
    await db
      .update(users)
      .set({ preferences: { mailboxVisits: [] } })
      .where(eq(users.id, userId));
    await visits.recordMailboxVisit(
      userId,
      inboxA,
      first,
      reads.indexedArrivals.bind(reads, inboxA),
      (executor) => mailboxes.assertVisitEligible(userId, inboxA, executor),
      finish,
    );
    const next = await visits.recordMailboxVisit(
      userId,
      inboxA,
      second,
      reads.indexedArrivals.bind(reads, inboxA),
      (executor) => mailboxes.assertVisitEligible(userId, inboxA, executor),
      start,
    );
    expect(next.since).toBe(finish.toISOString());
    expect(next.until).toBe(finish.toISOString());
  });
});
