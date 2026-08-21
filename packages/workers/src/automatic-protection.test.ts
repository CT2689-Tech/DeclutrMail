import { mailMessages, schema, senderPolicies, senders } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyAutomaticProtection } from './automatic-protection.js';

/**
 * Auto-protection rules, tested directly (D245 §2.6).
 *
 * The sweep decides who is excluded from bulk and automatic
 * mail-changing actions. Existing coverage reaches it only through
 * `InitialSyncWorker`, so the rules themselves — and crucially their
 * PRIORITY — were asserted incidentally rather than pinned.
 *
 * That matters because the sweep was rewritten from three correlated
 * subqueries per sender into one grouped pass per mailbox. The values
 * are equivalent (verified on production: 11,419 senders, 0
 * disagreements), but "equivalent today" is not a property a test
 * enforces tomorrow. These do.
 */
type Db = ReturnType<typeof drizzle<typeof schema>>;

const YEAR_AGO_ISH = new Date(Date.now() - 30 * 86_400_000);
const LONG_AGO = new Date(Date.now() - 400 * 86_400_000);

describe('applyAutomaticProtection', () => {
  let db: Db;
  let mailboxId: string;

  beforeEach(async () => {
    db = await freshTestDb();
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'W' })
      .returning({ id: schema.workspaces.id });
    const [user] = await db
      .insert(schema.users)
      .values({ workspaceId: ws!.id, email: 'o@ex.com' })
      .returning({ id: schema.users.id });
    const [mb] = await db
      .insert(schema.mailboxAccounts)
      .values({
        workspaceId: ws!.id,
        userId: user!.id,
        provider: 'gmail',
        providerAccountId: 'acct-1',
      })
      .returning({ id: schema.mailboxAccounts.id });
    mailboxId = mb!.id;
  });

  async function seedSender(
    key: string,
    opts: { wroteToCount?: number; gmailCategory?: 'primary' | 'promotions' } = {},
  ) {
    await db.insert(senders).values({
      mailboxAccountId: mailboxId,
      senderKey: key,
      email: `${key}@ex.com`,
      domain: 'ex.com',
      gmailCategory: opts.gmailCategory ?? 'primary',
      wroteToCount: opts.wroteToCount ?? 0,
      firstSeenAt: LONG_AGO,
      lastSeenAt: YEAR_AGO_ISH,
    });
  }

  async function seedMessage(
    key: string,
    id: string,
    labelIds: string[],
    internalDate: Date = YEAR_AGO_ISH,
  ) {
    await db.insert(mailMessages).values({
      mailboxAccountId: mailboxId,
      providerMessageId: id,
      providerThreadId: `t-${id}`,
      senderKey: key,
      subject: 's',
      snippet: '',
      internalDate,
      labelIds,
      isUnread: false,
      isOutbound: false,
    });
  }

  async function sweep() {
    await db.transaction(async (tx) => {
      await applyAutomaticProtection(tx as never, mailboxId);
    });
    const rows = await db
      .select({ senderKey: senderPolicies.senderKey, reason: senderPolicies.protectionReason })
      .from(senderPolicies)
      .where(eq(senderPolicies.mailboxAccountId, mailboxId));
    return new Map(rows.map((r) => [r.senderKey, r.reason]));
  }

  it('protects a sender replied to 3+ times', async () => {
    await seedSender('replied', { wroteToCount: 3 });
    await seedMessage('replied', 'm1', ['INBOX']);
    expect((await sweep()).get('replied')).toBe('replied');
  });

  it('does NOT protect on replies alone when no inbound mail exists', async () => {
    // Blind case for the rule above: `wrote_to_count` is outbound, so
    // without an inbound row there is no sender relationship to protect.
    await seedSender('outbound-only', { wroteToCount: 9 });
    expect((await sweep()).get('outbound-only')).toBeUndefined();
  });

  it('protects a sender with a star in the past year', async () => {
    await seedSender('starred');
    await seedMessage('starred', 'm2', ['INBOX', 'STARRED']);
    expect((await sweep()).get('starred')).toBe('starred');
  });

  it('ignores a star older than a year', async () => {
    await seedSender('old-star');
    await seedMessage('old-star', 'm3', ['INBOX', 'STARRED'], LONG_AGO);
    expect((await sweep()).get('old-star')).toBeUndefined();
  });

  it('protects a Primary sender with 3+ recent Important messages', async () => {
    await seedSender('important', { gmailCategory: 'primary' });
    for (const n of [1, 2, 3]) await seedMessage('important', `imp-${n}`, ['INBOX', 'IMPORTANT']);
    expect((await sweep()).get('important')).toBe('gmail_important');
  });

  it('does NOT protect on 2 Important messages', async () => {
    // Blind case for the threshold: 3 is the rule, not "some".
    await seedSender('two-important', { gmailCategory: 'primary' });
    for (const n of [1, 2]) await seedMessage('two-important', `ti-${n}`, ['INBOX', 'IMPORTANT']);
    expect((await sweep()).get('two-important')).toBeUndefined();
  });

  it('does NOT protect a non-Primary sender on Important alone', async () => {
    await seedSender('promo-important', { gmailCategory: 'promotions' });
    for (const n of [1, 2, 3])
      await seedMessage('promo-important', `pi-${n}`, ['INBOX', 'IMPORTANT']);
    expect((await sweep()).get('promo-important')).toBeUndefined();
  });

  it('reports the HIGHEST-priority reason when a sender matches several', async () => {
    // THE ORDER IS THE PRODUCT, not an implementation detail: the reason
    // is shown to the user and must be the strongest signal, not
    // whichever rule the query happened to evaluate first. A rewrite
    // that reordered these would still protect the same senders and
    // would pass every other test in this file.
    await seedSender('all-three', { wroteToCount: 5, gmailCategory: 'primary' });
    await seedMessage('all-three', 'a1', ['INBOX', 'STARRED', 'IMPORTANT']);
    await seedMessage('all-three', 'a2', ['INBOX', 'IMPORTANT']);
    await seedMessage('all-three', 'a3', ['INBOX', 'IMPORTANT']);
    expect((await sweep()).get('all-three')).toBe('replied');

    await seedSender('star-and-important', { gmailCategory: 'primary' });
    for (const n of [1, 2, 3])
      await seedMessage('star-and-important', `si-${n}`, ['INBOX', 'IMPORTANT']);
    await seedMessage('star-and-important', 'si-star', ['INBOX', 'STARRED']);
    expect((await sweep()).get('star-and-important')).toBe('starred');
  });

  it('leaves an unremarkable sender unprotected', async () => {
    // The blind case for the whole sweep: if this ever returns a reason,
    // every assertion above is passing vacuously.
    await seedSender('plain');
    await seedMessage('plain', 'p1', ['INBOX']);
    expect((await sweep()).get('plain')).toBeUndefined();
  });
});
