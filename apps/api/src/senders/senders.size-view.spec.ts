import { createHash, randomUUID } from 'node:crypto';

import { mailMessages, mailboxAccounts, senders, users, workspaces } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

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

describe('sender stored size', () => {
  let db: Db;
  let mailboxId: string;
  let svc: SendersReadService;

  beforeEach(async () => {
    db = await freshTestDb();
    mailboxId = await seedMailbox(db);
    svc = new SendersReadService(db as never);
  });

  it('sums inbound mail including Trash, excludes outbound, and pages largest first', async () => {
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

  it('pages equal sizes without skipping or repeating a sender', async () => {
    const left = await seedSender(db, mailboxId, 'left@x.com');
    const right = await seedSender(db, mailboxId, 'right@x.com');
    await seedMessage(db, {
      mailboxAccountId: mailboxId,
      senderKey: left.senderKey,
      sizeBytes: 1_000,
    });
    await seedMessage(db, {
      mailboxAccountId: mailboxId,
      senderKey: right.senderKey,
      sizeBytes: 1_000,
    });

    const page1 = await svc.listSenders({
      mailboxAccountId: mailboxId,
      category: null,
      sort: 'size',
      direction: 'desc',
      cursor: null,
      limit: 1,
    });
    const first = page1[0]!;
    const page2 = await svc.listSenders({
      mailboxAccountId: mailboxId,
      category: null,
      sort: 'size',
      direction: 'desc',
      cursor: { key: String(first.sizeBytes), id: first.id },
      limit: 1,
    });
    const seen = new Set([first.id, ...page2.map((row) => row.id)]);
    expect(seen).toEqual(new Set([left.id, right.id]));
    expect(page2.some((row) => row.id === first.id)).toBe(false);
    expect(page2).toHaveLength(1);
  });

  it('pages size ascending, smallest first, then the equal-size tie', async () => {
    const small = await seedSender(db, mailboxId, 'asc-small@x.com');
    const tiedA = await seedSender(db, mailboxId, 'asc-a@x.com');
    const tiedB = await seedSender(db, mailboxId, 'asc-b@x.com');
    await seedMessage(db, {
      mailboxAccountId: mailboxId,
      senderKey: small.senderKey,
      sizeBytes: 100,
    });
    await seedMessage(db, {
      mailboxAccountId: mailboxId,
      senderKey: tiedA.senderKey,
      sizeBytes: 500,
    });
    await seedMessage(db, {
      mailboxAccountId: mailboxId,
      senderKey: tiedB.senderKey,
      sizeBytes: 500,
    });

    const first = await svc.listSenders({
      mailboxAccountId: mailboxId,
      category: null,
      sort: 'size',
      direction: 'asc',
      cursor: null,
      limit: 1,
    });
    expect(first[0]).toMatchObject({ id: small.id, sizeBytes: 100 });
    const rest = await svc.listSenders({
      mailboxAccountId: mailboxId,
      category: null,
      sort: 'size',
      direction: 'asc',
      cursor: { key: String(first[0]!.sizeBytes), id: first[0]!.id },
      limit: 2,
    });
    expect(new Set(rest.map((row) => row.id))).toEqual(new Set([tiedA.id, tiedB.id]));
    expect(rest.some((row) => row.id === small.id)).toBe(false);
  });

  it('can answer the size sum from the inbound size index', async () => {
    const sender = await seedSender(db, mailboxId, 'plan@x.com');
    const other = await seedSender(db, mailboxId, 'other@x.com');
    await db.execute(sql`
      INSERT INTO mail_messages (
        mailbox_account_id, provider_message_id, provider_thread_id, sender_key,
        internal_date, is_unread, is_outbound, size_bytes, label_ids
      )
      SELECT
        ${mailboxId}::uuid,
        'bulk-' || src.n,
        'thr-' || src.n,
        CASE WHEN src.n <= 80 THEN ${sender.senderKey} ELSE ${other.senderKey} END,
        '2026-02-01T00:00:00Z'::timestamptz,
        false,
        false,
        1000 + src.n,
        ARRAY['INBOX']::text[]
      FROM (
        SELECT n
        FROM generate_series(1, 20000) AS n
      ) AS src
    `);
    const listed = await db.execute(
      sql`select indexname from pg_indexes where indexname = 'mail_messages_account_sender_inbound_size_idx'`,
    );
    const raw = listed as unknown as
      { rows?: Array<{ indexname: string }> } | Array<{ indexname: string }>;
    const indexRows = Array.isArray(raw) ? raw : (raw.rows ?? []);
    expect(indexRows.map((row) => row.indexname)).toContain(
      'mail_messages_account_sender_inbound_size_idx',
    );
    await db.execute(sql`VACUUM ANALYZE mail_messages`);
    const explained = await db.execute(sql`
      EXPLAIN SELECT SUM(size_bytes)
      FROM mail_messages
      WHERE mailbox_account_id = ${mailboxId}::uuid
        AND sender_key = ${sender.senderKey}
        AND is_outbound = false
    `);
    const plan = JSON.stringify(explained);
    expect(plan).toContain('mail_messages_account_sender_inbound_size_idx');
    expect(plan).not.toContain('Seq Scan');
  });
});
