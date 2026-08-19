import {
  mailMessages,
  mailboxAccounts,
  senderTimeseries,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { reconcileSenderTimeseries } from './sender-timeseries-reconcile.js';
import type { OutboxTx } from './outbox-publisher.js';

/**
 * Direct coverage for the reconcile SQL.
 *
 * It reached the suite only incidentally through the two sync workers,
 * where the module's own doc says it is a near-noop on a fresh backfill
 * — so the cases that actually matter (the zeroing branch, the
 * `read_count <= volume` invariant, the UTC month key) had no test at
 * all. Every case below corresponds to a defect this helper either fixes
 * or previously introduced.
 */

type Db = Awaited<ReturnType<typeof freshTestDb>>;

const SENDER_KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);

let db: Db;
let mailboxId: string;

let mailboxSeq = 0;

async function seedMailbox(database: Db): Promise<string> {
  mailboxSeq += 1;
  const email = `owner${mailboxSeq}@declutrmail.ai`;
  const [ws] = await database
    .insert(workspaces)
    .values({ name: 'Test WS' })
    .returning({ id: workspaces.id });
  const [user] = await database
    .insert(users)
    .values({ workspaceId: ws!.id, email })
    .returning({ id: users.id });
  const [mailbox] = await database
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: email,
    })
    .returning({ id: mailboxAccounts.id });
  return mailbox!.id;
}

async function seedSender(senderKey: string, email: string): Promise<void> {
  await db.insert(senders).values({
    mailboxAccountId: mailboxId,
    senderKey,
    displayName: 'Test Sender',
    email,
    domain: 'example.com',
    gmailCategory: 'promotions',
    firstSeenAt: new Date('2026-01-01T00:00:00Z'),
    lastSeenAt: new Date('2026-08-01T00:00:00Z'),
  });
}

async function seedMessage(opts: {
  id: string;
  senderKey?: string;
  internalDate: string;
  isUnread: boolean;
  isOutbound?: boolean;
}): Promise<void> {
  await db.insert(mailMessages).values({
    mailboxAccountId: mailboxId,
    providerMessageId: opts.id,
    providerThreadId: `t-${opts.id}`,
    senderKey: opts.senderKey ?? SENDER_KEY,
    subject: 'Subject',
    snippet: 'Snippet',
    internalDate: new Date(opts.internalDate),
    labelIds: opts.isUnread ? ['UNREAD', 'INBOX'] : ['INBOX'],
    isUnread: opts.isUnread,
    isOutbound: opts.isOutbound ?? false,
    unsubscribeOneClick: false,
  });
}

async function seedTimeseries(
  yearMonth: string,
  volume: number,
  readCount: number,
  senderKey = SENDER_KEY,
): Promise<void> {
  await db
    .insert(senderTimeseries)
    .values({ mailboxAccountId: mailboxId, senderKey, yearMonth, volume, readCount });
}

async function rowFor(yearMonth: string, senderKey = SENDER_KEY) {
  const [row] = await db
    .select()
    .from(senderTimeseries)
    .where(
      and(
        eq(senderTimeseries.mailboxAccountId, mailboxId),
        eq(senderTimeseries.senderKey, senderKey),
        eq(senderTimeseries.yearMonth, yearMonth),
      ),
    );
  return row;
}

/** The helper takes the caller's transaction; the tests pass the db. */
const asTx = (): OutboxTx => db as unknown as OutboxTx;

beforeEach(async () => {
  db = await freshTestDb();
  mailboxId = await seedMailbox(db);
  await seedSender(SENDER_KEY, 'sender@example.com');
});

describe('reconcileSenderTimeseries', () => {
  it('corrects a read_count frozen at insert time — the F009 defect', async () => {
    // Nine messages arrived unread and one was read afterwards. The
    // insert-time counter never saw the label flip.
    for (let i = 0; i < 9; i += 1) {
      await seedMessage({
        id: `m${i}`,
        internalDate: '2026-08-10T12:00:00Z',
        isUnread: i !== 0,
      });
    }
    await seedTimeseries('2026-08-01', 9, 0);

    const result = await reconcileSenderTimeseries(asTx(), mailboxId);

    expect(await rowFor('2026-08-01')).toMatchObject({ volume: 9, readCount: 1 });
    expect(result.corrected).toBe(1);
  });

  it('never leaves read_count above volume, even from a stale denominator', async () => {
    // The bug a rollback-guarded dry run caught before it shipped:
    // recomputing the numerator against an undercounting `volume` put
    // 269 rows above 1.0, which cascade rule 5 reads as engaged.
    await seedMessage({ id: 'r1', internalDate: '2026-07-05T12:00:00Z', isUnread: false });
    await seedMessage({ id: 'r2', internalDate: '2026-07-06T12:00:00Z', isUnread: false });
    await seedTimeseries('2026-07-01', 1, 0); // volume UNDERCOUNTS reality

    await reconcileSenderTimeseries(asTx(), mailboxId);

    const row = await rowFor('2026-07-01');
    expect(row).toMatchObject({ volume: 2, readCount: 2 });
    expect(row!.readCount).toBeLessThanOrEqual(row!.volume);
  });

  it('zeroes a month whose messages are all gone rather than stranding a count', async () => {
    await seedTimeseries('2026-03-01', 12, 4); // tombstoned; no messages remain

    const result = await reconcileSenderTimeseries(asTx(), mailboxId);

    expect(await rowFor('2026-03-01')).toMatchObject({ volume: 0, readCount: 0 });
    expect(result.zeroed).toBe(1);
  });

  it('keys months in UTC, matching the writer', async () => {
    // `startOfMonthISO` uses getUTCMonth(); a session-zone `date_trunc`
    // disagrees for a message near a boundary and the zeroing pass then
    // wipes a live row. 2026-08-01T00:30Z is July 31 in any negative
    // offset, so a local truncation would file it under 2026-07.
    await seedMessage({ id: 'edge', internalDate: '2026-08-01T00:30:00Z', isUnread: false });
    await seedTimeseries('2026-08-01', 1, 0);

    await reconcileSenderTimeseries(asTx(), mailboxId);

    expect(await rowFor('2026-08-01')).toMatchObject({ volume: 1, readCount: 1 });
  });

  it('excludes outbound mail from both counters', async () => {
    await seedMessage({ id: 'in', internalDate: '2026-06-10T12:00:00Z', isUnread: false });
    await seedMessage({
      id: 'out',
      internalDate: '2026-06-11T12:00:00Z',
      isUnread: false,
      isOutbound: true,
    });
    await seedTimeseries('2026-06-01', 99, 99);

    await reconcileSenderTimeseries(asTx(), mailboxId);

    expect(await rowFor('2026-06-01')).toMatchObject({ volume: 1, readCount: 1 });
  });

  it('is idempotent — a second run corrects nothing', async () => {
    await seedMessage({ id: 'i1', internalDate: '2026-05-04T12:00:00Z', isUnread: false });
    await seedTimeseries('2026-05-01', 5, 5);

    const first = await reconcileSenderTimeseries(asTx(), mailboxId);
    const second = await reconcileSenderTimeseries(asTx(), mailboxId);

    expect(first.corrected).toBe(1);
    expect(second.corrected).toBe(0);
    expect(second.zeroed).toBe(0);
  });

  it('does not touch another mailbox', async () => {
    const otherMailbox = await seedMailbox(db);
    await db.insert(senders).values({
      mailboxAccountId: otherMailbox,
      senderKey: OTHER_KEY,
      displayName: 'Other',
      email: 'other@example.com',
      domain: 'example.com',
      gmailCategory: 'promotions',
      firstSeenAt: new Date('2026-01-01T00:00:00Z'),
      lastSeenAt: new Date('2026-08-01T00:00:00Z'),
    });
    await db.insert(senderTimeseries).values({
      mailboxAccountId: otherMailbox,
      senderKey: OTHER_KEY,
      yearMonth: '2026-08-01',
      volume: 7,
      readCount: 3,
    });

    await reconcileSenderTimeseries(asTx(), mailboxId);

    const [untouched] = await db
      .select()
      .from(senderTimeseries)
      .where(eq(senderTimeseries.mailboxAccountId, otherMailbox));
    expect(untouched).toMatchObject({ volume: 7, readCount: 3 });
  });
});
