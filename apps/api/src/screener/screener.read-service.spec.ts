import {
  mailboxAccounts,
  mailMessages,
  schema,
  screenerQuarantine,
  senderPolicies,
  senders,
  triageDecisions,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { ScreenerReadService } from './screener.read-service.js';

/**
 * ScreenerReadService integration tests (D71–D74).
 *
 * Load-bearing behaviour: ONLY pending quarantine rows surface (a
 * decided row leaves both the queue and the badge count), the row
 * carries the joined sender identity + the engine recommendation +
 * the latest message's subject, and everything is mailbox-scoped.
 * Both sides of each join are seeded with ≥2 rows so a degenerate
 * correlation fails loudly (the Drizzle bare-column pitfall class).
 */

type Db = ReturnType<typeof drizzle<typeof schema>>;

const SENDER_A = 'a'.repeat(64);
const SENDER_B = 'b'.repeat(64);

async function freshDb(): Promise<Db> {
  return freshTestDb();
}

async function seedMailbox(db: Db, tag: string): Promise<string> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS-${tag}` })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: `${tag}@declutrmail.ai` })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: `${tag}@x`,
    })
    .returning({ id: mailboxAccounts.id });
  return mailbox!.id;
}

/** Seed a sender + two messages (older + newest) + a pending queue row. */
async function seedQueuedSender(
  db: Db,
  mailboxAccountId: string,
  senderKey: string,
  email: string,
  opts: { withDecision?: boolean; newestSubject?: string } = {},
): Promise<void> {
  await db.insert(senders).values({
    mailboxAccountId,
    senderKey,
    email,
    displayName: email.split('@')[0]!,
    domain: email.split('@')[1]!,
    gmailCategory: 'updates',
    firstSeenAt: new Date('2026-06-09T10:00:00Z'),
    lastSeenAt: new Date('2026-06-10T10:00:00Z'),
    totalReceived: 2,
  });
  await db.insert(mailMessages).values([
    {
      mailboxAccountId,
      providerMessageId: `${senderKey.slice(0, 6)}-old`,
      providerThreadId: 't1',
      senderKey,
      subject: 'Older subject',
      snippet: '',
      internalDate: new Date('2026-06-09T10:00:00Z'),
      labelIds: ['INBOX'],
      isUnread: true,
    },
    {
      mailboxAccountId,
      providerMessageId: `${senderKey.slice(0, 6)}-new`,
      providerThreadId: 't2',
      senderKey,
      subject: opts.newestSubject ?? 'Newest subject',
      snippet: '',
      internalDate: new Date('2026-06-10T10:00:00Z'),
      labelIds: ['INBOX'],
      isUnread: true,
    },
  ]);
  if (opts.withDecision ?? true) {
    await db.insert(triageDecisions).values({
      mailboxAccountId,
      senderKey,
      verdict: 'later',
      confidence: '0.70',
      reasoning: 'Too new to judge.',
      generatedBy: 'template',
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });
  }
  await db.insert(screenerQuarantine).values({ mailboxAccountId, senderKey });
}

describe('ScreenerReadService (D71–D74)', () => {
  let db: Db;
  let mailboxId: string;
  let svc: ScreenerReadService;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db, 'one');
    await seedQueuedSender(db, mailboxId, SENDER_A, 'alpha@new.example', {
      newestSubject: 'Welcome to Alpha',
    });
    await seedQueuedSender(db, mailboxId, SENDER_B, 'beta@fresh.example', {
      withDecision: false,
      newestSubject: 'Beta receipt',
    });
    svc = new ScreenerReadService(db as never);
  });

  it('lists pending rows with sender identity, latest subject, and recommendation', async () => {
    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 50 });
    expect(rows.map((r) => r.senderKey).sort()).toEqual([SENDER_A, SENDER_B]);

    const alpha = rows.find((r) => r.senderKey === SENDER_A)!;
    expect(alpha.senderId).toMatch(/^[0-9a-f-]{36}$/);
    expect(alpha.senderEmail).toBe('alpha@new.example');
    expect(alpha.senderDomain).toBe('new.example');
    expect(alpha.messageCount).toBe(2);
    // Latest message wins the sample-subject slot (D71).
    expect(alpha.sampleSubject).toBe('Welcome to Alpha');
    // `toMatchObject`, not `toEqual`: the age fields (`scoredAt` /
    // `stale`) are clock-derived, and asserting them here would make
    // this identity-and-subject test fail for a reason it is not about.
    // Their own behaviour is covered in the D25 describe block below.
    expect(alpha.recommendation).toMatchObject({
      verdict: 'later',
      confidence: 0.7,
      reasoning: 'Too new to judge.',
    });

    // No decision row yet → recommendation is null, row still renders.
    const beta = rows.find((r) => r.senderKey === SENDER_B)!;
    expect(beta.recommendation).toBeNull();
    expect(beta.sampleSubject).toBe('Beta receipt');

    // No policy row at all ⇒ not protected. Both sides asserted so a
    // LEFT JOIN that silently drops policy-less senders would fail.
    expect(alpha.isProtected).toBe(false);
    expect(alpha.protectionReason).toBeNull();

    // Both seeded messages carry INBOX — the ADR-0028 companion count
    // matches the received count when nothing sits outside the inbox.
    expect(alpha.inboxCount).toBe(2);
  });

  it('carries a live per-row inboxCount — received mail outside the inbox is excluded (ADR-0028)', async () => {
    // Founder repro (2026-07-30): total_received 1 with the one message
    // in SPAM, so Delete's inbox preview truthfully found 0 and the row
    // read as a bug. The row now states both numbers. Three senders
    // with three DISTINCT counts (2 / 1 / 0), ≥2 message rows per
    // sender — a degenerate correlation (the Drizzle bare-column
    // pitfall) would report one mailbox-wide count on every row.
    const SENDER_C = 'c'.repeat(64);
    await db.insert(senders).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_C,
      email: 'gamma@spam.example',
      displayName: 'gamma',
      domain: 'spam.example',
      gmailCategory: 'updates',
      firstSeenAt: new Date('2026-06-09T10:00:00Z'),
      lastSeenAt: new Date('2026-06-10T10:00:00Z'),
      totalReceived: 2,
    });
    await db.insert(mailMessages).values([
      {
        // The founder's exact shape — spam-foldered, never in the inbox.
        mailboxAccountId: mailboxId,
        providerMessageId: 'cccccc-spam',
        providerThreadId: 't3',
        senderKey: SENDER_C,
        subject: 'Spam-folder arrival',
        snippet: '',
        internalDate: new Date('2026-06-09T11:00:00Z'),
        labelIds: ['CATEGORY_PROMOTIONS', 'UNREAD', 'SPAM'],
        isUnread: true,
      },
      {
        // Outbound carrying INBOX — excluded too (`is_outbound = false`).
        mailboxAccountId: mailboxId,
        providerMessageId: 'cccccc-out',
        providerThreadId: 't3',
        senderKey: SENDER_C,
        subject: 'Re: Spam-folder arrival',
        snippet: '',
        internalDate: new Date('2026-06-09T12:00:00Z'),
        labelIds: ['INBOX'],
        isUnread: false,
        isOutbound: true,
      },
    ]);
    await db
      .insert(screenerQuarantine)
      .values({ mailboxAccountId: mailboxId, senderKey: SENDER_C });
    // Archive one of beta's two inbox messages so all three rows carry
    // different true values.
    await db
      .update(mailMessages)
      .set({ labelIds: ['CATEGORY_UPDATES'] })
      .where(
        and(
          eq(mailMessages.mailboxAccountId, mailboxId),
          eq(mailMessages.providerMessageId, `${SENDER_B.slice(0, 6)}-old`),
        ),
      );

    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 50 });
    const byKey = new Map(rows.map((r) => [r.senderKey, r]));
    expect(byKey.get(SENDER_A)!.inboxCount).toBe(2);
    expect(byKey.get(SENDER_B)!.inboxCount).toBe(1);
    const gamma = byKey.get(SENDER_C)!;
    expect(gamma.messageCount).toBe(2);
    expect(gamma.inboxCount).toBe(0);
  });

  it('carries standing protection so the decide preview can name it (D42/D245)', async () => {
    // A queued sender CAN be protected: the automatic sweep runs over
    // every sender with no Screener exclusion, and Sender Detail can
    // protect one by hand while it waits. Without this on the wire the
    // decision is a silent 409 the user cannot resolve in place.
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_A,
      isProtected: true,
      protectionReason: 'starred',
      protectionSetAt: new Date('2026-06-09T12:00:00Z'),
    });

    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 50 });
    const alpha = rows.find((r) => r.senderKey === SENDER_A)!;
    expect(alpha.isProtected).toBe(true);
    expect(alpha.protectionReason).toBe('starred');

    // Unprotecting must clear the reason too — a reason surviving a
    // false flag would render "Protected" copy on a free sender.
    await db
      .update(senderPolicies)
      .set({ isProtected: false })
      .where(
        and(eq(senderPolicies.mailboxAccountId, mailboxId), eq(senderPolicies.senderKey, SENDER_A)),
      );
    const after = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 50 });
    const alphaAfter = after.find((r) => r.senderKey === SENDER_A)!;
    expect(alphaAfter.isProtected).toBe(false);
    expect(alphaAfter.protectionReason).toBeNull();
  });

  it('excludes decided rows from the queue and the count', async () => {
    // Only sender A is decided.
    await db
      .update(screenerQuarantine)
      .set({ decidedAt: new Date() })
      .where(
        and(
          eq(screenerQuarantine.mailboxAccountId, mailboxId),
          eq(screenerQuarantine.senderKey, SENDER_A),
        ),
      );
    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 50 });
    expect(rows.map((r) => r.senderKey)).toEqual([SENDER_B]);
    const count = await svc.pendingCount(mailboxId);
    expect(count.pending).toBe(1);
  });

  it('is mailbox-scoped — another mailbox sees nothing', async () => {
    const otherMailbox = await seedMailbox(db, 'two');
    const rows = await svc.listQueue({ mailboxAccountId: otherMailbox, limit: 50 });
    expect(rows).toEqual([]);
    const count = await svc.pendingCount(otherMailbox);
    expect(count.pending).toBe(0);
  });

  it('counts every pending row for the badge (D74)', async () => {
    const count = await svc.pendingCount(mailboxId);
    expect(count.pending).toBe(2);
  });

  it('orders newest-queued first and honours the limit', async () => {
    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 1 });
    expect(rows).toHaveLength(1);
    // SENDER_B was queued second → newest-first puts it on top.
    expect(rows[0]!.senderKey).toBe(SENDER_B);
  });
});

describe('ScreenerReadService — the age of the engine read (D25)', () => {
  let db: Db;
  let mailboxId: string;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db, 'screener-age');
  });

  /**
   * A quarantined sender leaves the Screener ONLY when a re-score gives
   * it a confident verdict — that graduation already exists in the score
   * worker, but no production trigger revisits an existing sender, so it
   * never fires. Carrying the TTL verdict on the wire is what lets the
   * screen ask for the re-score that graduates the row.
   *
   * Two rows, opposite states, so an implementation that hard-codes
   * either answer fails.
   */
  it('reports scored-at and TTL state per recommendation', async () => {
    const scoredAt = new Date(Date.now() - 40 * 86_400_000);
    await seedQueuedSender(db, mailboxId, SENDER_A, 'aged@ex.com');
    await seedQueuedSender(db, mailboxId, SENDER_B, 'fresh@ex.com');
    await db
      .update(triageDecisions)
      .set({ producedAt: scoredAt, expiresAt: new Date(Date.now() - 33 * 86_400_000) })
      .where(eq(triageDecisions.senderKey, SENDER_A));

    const rows = await new ScreenerReadService(db as never).listQueue({
      mailboxAccountId: mailboxId,
      limit: 10,
    });
    const byKey = new Map(rows.map((r) => [r.senderKey, r]));

    expect(byKey.get(SENDER_A)?.recommendation?.stale).toBe(true);
    expect(byKey.get(SENDER_A)?.recommendation?.scoredAt).toBe(scoredAt.toISOString());
    expect(byKey.get(SENDER_B)?.recommendation?.stale).toBe(false);
  });

  /**
   * The join to `triage_decisions` is a LEFT one: the engine may never
   * have reached this sender. `recommendation` stays null rather than
   * inventing a scored-at — the FE reads null as "never scored", which
   * is a different fact from "scored and aged out" and drives the same
   * refresh for a different reason.
   */
  it('leaves the recommendation null when the engine never scored the sender', async () => {
    await seedQueuedSender(db, mailboxId, SENDER_A, 'unscored@ex.com', { withDecision: false });

    const rows = await new ScreenerReadService(db as never).listQueue({
      mailboxAccountId: mailboxId,
      limit: 10,
    });
    expect(rows.find((r) => r.senderKey === SENDER_A)?.recommendation).toBeNull();
  });
});
