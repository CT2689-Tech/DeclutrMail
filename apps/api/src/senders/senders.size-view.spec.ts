import { createHash, randomUUID } from 'node:crypto';

import { mailMessages, mailboxAccounts, senders, users, workspaces } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SendersReadService } from './senders.read-service.js';

type Db = Awaited<ReturnType<typeof freshTestDb>>;

function senderKeyFor(email: string): string {
  return createHash('sha256').update(`v1|${email.toLowerCase()}`).digest('hex');
}

async function seedMailbox(db: Db): Promise<string> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'WS-size' })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'size@declutrmail.ai' })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: 'size@declutrmail.ai',
    })
    .returning({ id: mailboxAccounts.id });
  return mailbox!.id;
}

async function seedSender(
  db: Db,
  mailboxAccountId: string,
  email: string,
): Promise<{ id: string; senderKey: string }> {
  const senderKey = senderKeyFor(email);
  const [row] = await db
    .insert(senders)
    .values({
      mailboxAccountId,
      senderKey,
      displayName: email,
      email,
      domain: email.split('@')[1] ?? '',
      gmailCategory: 'updates',
      firstSeenAt: new Date('2026-01-01T00:00:00Z'),
      lastSeenAt: new Date('2026-02-01T00:00:00Z'),
    })
    .returning({ id: senders.id });
  return { id: row!.id, senderKey };
}

async function seedMessage(
  db: Db,
  args: {
    mailboxAccountId: string;
    senderKey: string;
    sizeBytes: number | null;
    labelIds?: string[];
    isOutbound?: boolean;
  },
): Promise<void> {
  const providerMessageId = `pmid-${randomUUID()}`;
  await db.insert(mailMessages).values({
    mailboxAccountId: args.mailboxAccountId,
    providerMessageId,
    providerThreadId: `thr-${providerMessageId}`,
    senderKey: args.senderKey,
    subject: 'Test',
    snippet: '',
    internalDate: new Date('2026-02-01T00:00:00Z'),
    isUnread: false,
    sizeBytes: args.sizeBytes,
    ...(args.labelIds ? { labelIds: args.labelIds } : {}),
    ...(args.isOutbound !== undefined ? { isOutbound: args.isOutbound } : {}),
  });
}

describe('SENDER_SIZE_VIEW', () => {
  let db: Db;
  let mailboxId: string;
  let svc: SendersReadService;

  beforeEach(async () => {
    db = await freshTestDb();
    mailboxId = await seedMailbox(db);
    svc = new SendersReadService(db as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects size sort and returns no size while the flag is off', async () => {
    const big = await seedSender(db, mailboxId, 'big@x.com');
    await seedMessage(db, {
      mailboxAccountId: mailboxId,
      senderKey: big.senderKey,
      sizeBytes: 2_000_000,
    });
    await expect(
      svc.listSenders({
        mailboxAccountId: mailboxId,
        category: null,
        sort: 'size',
        cursor: null,
        limit: 10,
      }),
    ).rejects.toThrow(/Unsupported sort: size/);
    const rows = await svc.listSenders({
      mailboxAccountId: mailboxId,
      category: null,
      cursor: null,
      limit: 10,
    });
    expect(rows[0]?.sizeBytes).toBeNull();
    const detail = await svc.getSenderDetail(mailboxId, big.id);
    expect(detail?.sizeBytes).toBeNull();
  });

  it('sums inbound mail including Trash, excludes outbound, and pages largest first', async () => {
    vi.stubEnv('SENDER_SIZE_VIEW', 'true');
    const big = await seedSender(db, mailboxId, 'big@x.com');
    const small = await seedSender(db, mailboxId, 'small@x.com');
    const unknown = await seedSender(db, mailboxId, 'unknown@x.com');
    await seedMessage(db, {
      mailboxAccountId: mailboxId,
      senderKey: big.senderKey,
      sizeBytes: 2_000_000,
    });
    await seedMessage(db, {
      mailboxAccountId: mailboxId,
      senderKey: big.senderKey,
      sizeBytes: 500_000,
      labelIds: ['TRASH'],
    });
    await seedMessage(db, {
      mailboxAccountId: mailboxId,
      senderKey: big.senderKey,
      sizeBytes: 9_000_000,
      isOutbound: true,
    });
    await seedMessage(db, {
      mailboxAccountId: mailboxId,
      senderKey: small.senderKey,
      sizeBytes: 400_000,
    });
    await seedMessage(db, {
      mailboxAccountId: mailboxId,
      senderKey: unknown.senderKey,
      sizeBytes: null,
    });

    const page1 = await svc.listSenders({
      mailboxAccountId: mailboxId,
      category: null,
      sort: 'size',
      direction: 'desc',
      cursor: null,
      limit: 1,
    });
    expect(page1.length).toBe(2);
    expect(page1[0]).toMatchObject({ id: big.id, sizeBytes: 2_500_000 });

    const page2 = await svc.listSenders({
      mailboxAccountId: mailboxId,
      category: null,
      sort: 'size',
      direction: 'desc',
      cursor: { key: String(page1[0]!.sizeBytes), id: page1[0]!.id },
      limit: 2,
    });
    expect(page2.map((row) => row.id)).toEqual([small.id, unknown.id]);
    expect(page2[0]?.sizeBytes).toBe(400_000);
    expect(page2[1]?.sizeBytes).toBeNull();

    const detail = await svc.getSenderDetail(mailboxId, big.id);
    expect(detail?.sizeBytes).toBe(2_500_000);
  });
});
