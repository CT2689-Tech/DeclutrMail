import {
  automationRules,
  followupTracker,
  mailboxAccounts,
  mailMessages,
  ruleMatchLog,
  screenerQuarantine,
  senderPolicies,
  senders,
  senderTimeseries,
  triageDecisions,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NON_MAIL_PURGE_BATCH,
  nonMailBatchDelete,
  purgeAllNonMail,
  purgeNonMailMessages,
} from './non-mail-purge.js';
import type { OutboxTx } from './outbox-publisher.js';
import { deriveSenderKey } from './sender-key.js';

/**
 * purgeNonMailMessages — clears stored drafts and chat lines, and the
 * derived state they fed (NON_MAIL_LABELS).
 *
 * Seeds the state the sync workers wrote before the ingest skip: drafts
 * stored as INBOUND mail From the owner (a senders row for the mailbox
 * itself), chat lines counted as email from whoever sent them.
 */

type Db = OutboxTx;
/** The test database's `transaction`, typed for the purge callback. */
type TxRunner = { transaction<T>(fn: (tx: OutboxTx) => Promise<T>): Promise<T> };

const OWNER = 'owner@declutrmail.ai';
const day = (d: number): Date => new Date(Date.UTC(2026, 2, d));

async function seedMailbox(db: Db, email: string): Promise<{ workspaceId: string; mb: string }> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS ${email}` })
    .returning();
  const [user] = await db.insert(users).values({ workspaceId: ws!.id, email }).returning();
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({ workspaceId: ws!.id, userId: user!.id, provider: 'gmail', providerAccountId: email })
    .returning();
  return { workspaceId: ws!.id, mb: mailbox!.id };
}

async function seedSender(
  db: Db,
  mb: string,
  email: string,
  row: { total: number; first: Date; last: Date; wroteTo?: number },
): Promise<string> {
  const senderKey = deriveSenderKey(email);
  await db.insert(senders).values({
    mailboxAccountId: mb,
    senderKey,
    email,
    domain: email.split('@')[1]!,
    gmailCategory: 'primary',
    firstSeenAt: row.first,
    lastSeenAt: row.last,
    totalReceived: row.total,
    wroteToCount: row.wroteTo ?? 0,
  });
  return senderKey;
}

async function seedMessage(
  db: Db,
  mb: string,
  m: {
    id: string;
    from: string;
    labelIds: string[];
    at: Date;
    thread?: string;
    recipients?: string[];
  },
): Promise<void> {
  const isOutbound = m.labelIds.includes('SENT');
  await db.insert(mailMessages).values({
    mailboxAccountId: mb,
    providerMessageId: m.id,
    providerThreadId: m.thread ?? `thread-${m.id}`,
    senderKey: deriveSenderKey(m.from),
    internalDate: m.at,
    labelIds: m.labelIds,
    isUnread: m.labelIds.includes('UNREAD'),
    isOutbound,
    recipientEmails: isOutbound ? (m.recipients ?? null) : null,
  });
}

async function seedDecision(db: Db, mb: string, senderKey: string): Promise<void> {
  await db.insert(triageDecisions).values({
    mailboxAccountId: mb,
    senderKey,
    verdict: 'keep',
    confidence: '0.95',
    reasoning: 'Sends 2/mo. You open 100%.',
    generatedBy: 'template',
    producedAt: day(12),
    expiresAt: day(30),
  });
}

async function storedIds(db: Db, mb: string): Promise<string[]> {
  const rows = await db
    .select({ id: mailMessages.providerMessageId })
    .from(mailMessages)
    .where(eq(mailMessages.mailboxAccountId, mb));
  return rows.map((r) => r.id).sort();
}

describe('purgeNonMailMessages', () => {
  let db: Db;

  beforeEach(async () => {
    db = (await freshTestDb()) as unknown as Db;
  });

  it('deletes drafts, chat lines and the senders only they fed — keeping the user’s own choices', async () => {
    const { mb } = await seedMailbox(db, OWNER);
    const other = await seedMailbox(db, 'other@declutrmail.ai');

    // The owner as a sender, built from nothing but their own drafts.
    const ownerKey = await seedSender(db, mb, OWNER, { total: 2, first: day(1), last: day(2) });
    await seedMessage(db, mb, { id: 'draft-1', from: OWNER, labelIds: ['DRAFT'], at: day(1) });
    await seedMessage(db, mb, { id: 'draft-2', from: OWNER, labelIds: ['DRAFT'], at: day(2) });
    // A contact known only from an old chat log.
    const buddyKey = await seedSender(db, mb, 'buddy@example.com', {
      total: 1,
      first: day(3),
      last: day(3),
    });
    await seedMessage(db, mb, {
      id: 'chat-1',
      from: 'buddy@example.com',
      labelIds: ['CHAT'],
      at: day(3),
    });

    // Rows derived from the owner-as-sender.
    await db
      .insert(senderTimeseries)
      .values({ mailboxAccountId: mb, senderKey: ownerKey, yearMonth: '2026-03-01', volume: 2 });
    await seedDecision(db, mb, ownerKey);
    await db.insert(screenerQuarantine).values({ mailboxAccountId: mb, senderKey: ownerKey });
    const [rule] = await db
      .insert(automationRules)
      .values({
        mailboxAccountId: mb,
        isPreset: true,
        presetKey: 'auto_archive_low_engagement',
        name: 'Auto-archive low engagement',
        enabled: false,
        mode: 'observe',
        scope: 'account',
        conditions: {},
        actionKind: 'archive',
        actionPayload: {},
      })
      .returning({ id: automationRules.id });
    const match = { ruleId: rule!.id, mailboxAccountId: mb, senderKey: ownerKey };
    await db.insert(ruleMatchLog).values([
      { ...match, modeAtMatch: 'observe', confidence: '0.90', reason: 'pending' },
      {
        ...match,
        modeAtMatch: 'active',
        confidence: '0.90',
        reason: 'executed',
        resolution: 'approved',
        intentApplied: true,
      },
    ]);
    // Sweep-authored protection on a sender with no mail must go; the
    // user's own protection on the chat-only contact must stay.
    await db.insert(senderPolicies).values([
      {
        mailboxAccountId: mb,
        senderKey: ownerKey,
        policyType: 'keep',
        isProtected: true,
        protectionReason: 'starred',
        protectionSetAt: day(2),
      },
      {
        mailboxAccountId: mb,
        senderKey: buddyKey,
        isProtected: true,
        protectionReason: 'user_defined',
        protectionSetAt: day(3),
      },
    ]);
    await db
      .insert(screenerQuarantine)
      .values({ mailboxAccountId: mb, senderKey: buddyKey, decidedAt: day(4) });

    // Another mailbox's draft is none of this purge's business.
    await seedSender(db, other.mb, 'other@declutrmail.ai', {
      total: 1,
      first: day(1),
      last: day(1),
    });
    await seedMessage(db, other.mb, {
      id: 'draft-x',
      from: 'other@declutrmail.ai',
      labelIds: ['DRAFT'],
      at: day(1),
    });

    const result = await purgeNonMailMessages(db, mb);

    expect(result).toEqual({
      messagesDeleted: 3,
      sendersDeleted: 2,
      sendersRecounted: 0,
      followupsReopened: 0,
    });
    expect(await storedIds(db, mb)).toEqual([]);
    const senderRows = await db.select({ email: senders.email }).from(senders);
    expect(senderRows.map((r) => r.email)).toEqual(['other@declutrmail.ai']);
    expect(await db.select().from(senderTimeseries)).toEqual([]);
    expect(await db.select().from(triageDecisions)).toEqual([]);
    const queue = await db
      .select({ senderKey: screenerQuarantine.senderKey })
      .from(screenerQuarantine);
    expect(queue).toEqual([{ senderKey: buddyKey }]);
    const matches = await db.select({ reason: ruleMatchLog.reason }).from(ruleMatchLog);
    expect(matches).toEqual([{ reason: 'executed' }]);
    const policies = await db
      .select({
        senderKey: senderPolicies.senderKey,
        policyType: senderPolicies.policyType,
        isProtected: senderPolicies.isProtected,
        protectionReason: senderPolicies.protectionReason,
      })
      .from(senderPolicies);
    expect(policies).toEqual(
      expect.arrayContaining([
        { senderKey: ownerKey, policyType: 'keep', isProtected: false, protectionReason: null },
        {
          senderKey: buddyKey,
          policyType: 'keep',
          isProtected: true,
          protectionReason: 'user_defined',
        },
      ]),
    );
    expect(await storedIds(db, other.mb)).toEqual(['draft-x']);

    // Idempotent: a clean mailbox is a no-op.
    expect(await purgeNonMailMessages(db, mb)).toEqual({
      messagesDeleted: 0,
      sendersDeleted: 0,
      sendersRecounted: 0,
      followupsReopened: 0,
    });
  });

  it('recounts a sender that also has real mail, and a SENT chat line stops counting as "you wrote to them"', async () => {
    const { mb } = await seedMailbox(db, OWNER);
    // A chat-only contact BESIDE senders with real mail. The phantom test
    // must see other mail in the same mailbox: a subquery that forgets the
    // outer sender (the Drizzle correlated-subquery pitfall) finds that
    // mail for everyone and would keep this contact.
    await seedSender(db, mb, 'buddy@example.com', { total: 1, first: day(2), last: day(2) });
    await seedMessage(db, mb, {
      id: 'chat-buddy',
      from: 'buddy@example.com',
      labelIds: ['CHAT'],
      at: day(2),
    });
    const friendKey = await seedSender(db, mb, 'friend@example.com', {
      total: 2,
      first: day(3),
      last: day(10),
      wroteTo: 2,
    });
    await seedMessage(db, mb, {
      id: 'mail-1',
      from: 'friend@example.com',
      labelIds: ['INBOX', 'CATEGORY_PERSONAL'],
      at: day(10),
    });
    await seedMessage(db, mb, {
      id: 'chat-in',
      from: 'friend@example.com',
      labelIds: ['CHAT'],
      at: day(3),
    });
    await seedMessage(db, mb, {
      id: 'sent-1',
      from: OWNER,
      labelIds: ['SENT'],
      at: day(11),
      recipients: ['friend@example.com'],
    });
    await seedMessage(db, mb, {
      id: 'chat-sent',
      from: OWNER,
      labelIds: ['CHAT', 'SENT'],
      at: day(4),
      recipients: ['friend@example.com'],
    });
    await seedDecision(db, mb, friendKey);
    // A sender the purge never touched keeps its (deliberately stale)
    // count and its fresh decision.
    const newsKey = await seedSender(db, mb, 'news@example.com', {
      total: 5,
      first: day(1),
      last: day(1),
    });
    await seedMessage(db, mb, {
      id: 'mail-2',
      from: 'news@example.com',
      labelIds: ['INBOX'],
      at: day(1),
    });
    await seedDecision(db, mb, newsKey);

    const result = await purgeNonMailMessages(db, mb);

    expect(result).toMatchObject({ messagesDeleted: 3, sendersDeleted: 1, sendersRecounted: 1 });
    expect(await storedIds(db, mb)).toEqual(['mail-1', 'mail-2', 'sent-1']);
    const emails = await db.select({ email: senders.email }).from(senders);
    expect(emails.map((r) => r.email).sort()).toEqual(['friend@example.com', 'news@example.com']);
    const rows = await db
      .select({
        senderKey: senders.senderKey,
        total: senders.totalReceived,
        first: senders.firstSeenAt,
        last: senders.lastSeenAt,
        wroteTo: senders.wroteToCount,
      })
      .from(senders);
    expect(rows).toEqual(
      expect.arrayContaining([
        { senderKey: friendKey, total: 1, first: day(10), last: day(10), wroteTo: 1 },
        { senderKey: newsKey, total: 5, first: day(1), last: day(1), wroteTo: 0 },
      ]),
    );
    const decisions = await db
      .select({
        senderKey: triageDecisions.senderKey,
        producedAt: triageDecisions.producedAt,
        expiresAt: triageDecisions.expiresAt,
      })
      .from(triageDecisions);
    expect(decisions).toEqual(
      expect.arrayContaining([
        { senderKey: friendKey, producedAt: day(12), expiresAt: day(12) },
        { senderKey: newsKey, producedAt: day(12), expiresAt: day(30) },
      ]),
    );
  });

  it('reopens a follow-up a draft marked replied — not one with a real reply, nor a dismissed one', async () => {
    const { workspaceId, mb } = await seedMailbox(db, OWNER);
    const tracker = (thread: string, status: 'replied' | 'dismissed') => ({
      workspaceId,
      mailboxAccountId: mb,
      providerThreadId: thread,
      recipientEmail: 'friend@example.com',
      sentAt: day(20),
      status,
    });
    for (const thread of ['t-draft', 't-real', 't-dismissed']) {
      await seedMessage(db, mb, {
        id: `sent-${thread}`,
        from: OWNER,
        labelIds: ['SENT'],
        at: day(20),
        thread,
        recipients: ['friend@example.com'],
      });
      await seedMessage(db, mb, {
        id: `draft-${thread}`,
        from: OWNER,
        labelIds: ['DRAFT'],
        at: day(21),
        thread,
      });
    }
    await seedMessage(db, mb, {
      id: 'reply-t-real',
      from: 'friend@example.com',
      labelIds: ['INBOX'],
      at: day(22),
      thread: 't-real',
    });
    await db
      .insert(followupTracker)
      .values([
        tracker('t-draft', 'replied'),
        tracker('t-real', 'replied'),
        tracker('t-dismissed', 'dismissed'),
      ]);

    const result = await purgeNonMailMessages(db, mb);

    expect(result.followupsReopened).toBe(1);
    const statuses = await db
      .select({ thread: followupTracker.providerThreadId, status: followupTracker.status })
      .from(followupTracker)
      .where(and(eq(followupTracker.mailboxAccountId, mb)));
    expect(statuses).toEqual(
      expect.arrayContaining([
        { thread: 't-draft', status: 'awaiting' },
        { thread: 't-real', status: 'replied' },
        { thread: 't-dismissed', status: 'dismissed' },
      ]),
    );
  });

  it('converges across batches — the batch that removes a sender’s last line deletes it, once', async () => {
    const { mb } = await seedMailbox(db, OWNER);
    await seedSender(db, mb, OWNER, { total: 2, first: day(1), last: day(2) });
    await seedSender(db, mb, 'buddy@example.com', { total: 3, first: day(1), last: day(3) });
    const friendKey = await seedSender(db, mb, 'friend@example.com', {
      total: 3,
      first: day(4),
      last: day(10),
    });
    for (const d of [1, 2]) {
      await seedMessage(db, mb, { id: `draft-${d}`, from: OWNER, labelIds: ['DRAFT'], at: day(d) });
    }
    for (const d of [1, 2, 3]) {
      await seedMessage(db, mb, {
        id: `chat-b${d}`,
        from: 'buddy@example.com',
        labelIds: ['CHAT'],
        at: day(d),
      });
    }
    for (const d of [4, 5]) {
      await seedMessage(db, mb, {
        id: `chat-f${d}`,
        from: 'friend@example.com',
        labelIds: ['CHAT', 'INBOX'],
        at: day(d),
      });
    }
    await seedMessage(db, mb, {
      id: 'mail-1',
      from: 'friend@example.com',
      labelIds: ['INBOX'],
      at: day(10),
    });
    let batches = 0;

    const result = await purgeAllNonMail(
      db,
      (purge) => {
        batches += 1;
        return (db as unknown as TxRunner).transaction(purge);
      },
      mb,
      undefined,
      2,
    );

    // 7 lines at 2 a batch: 2 + 2 + 2 + 1, and the short batch ends it.
    expect(batches).toBe(4);
    expect(result).toMatchObject({ messagesDeleted: 7, sendersDeleted: 2 });
    expect(await storedIds(db, mb)).toEqual(['mail-1']);
    const rows = await db
      .select({
        senderKey: senders.senderKey,
        total: senders.totalReceived,
        first: senders.firstSeenAt,
        last: senders.lastSeenAt,
      })
      .from(senders);
    expect(rows).toEqual([{ senderKey: friendKey, total: 1, first: day(10), last: day(10) }]);
  });

  it('a clean mailbox costs one probe — no batch, so no lock and no transaction', async () => {
    const { mb } = await seedMailbox(db, OWNER);
    await seedSender(db, mb, 'friend@example.com', { total: 1, first: day(1), last: day(1) });
    await seedMessage(db, mb, {
      id: 'mail-1',
      from: 'friend@example.com',
      labelIds: ['INBOX'],
      at: day(1),
    });
    const runBatch = vi.fn();

    const result = await purgeAllNonMail(db, runBatch, mb);

    expect(runBatch).not.toHaveBeenCalled();
    expect(result.messagesDeleted).toBe(0);
    expect(await storedIds(db, mb)).toEqual(['mail-1']);
  });

  it('deletes through mail_messages_non_mail_idx, not a scan of the mailbox', async () => {
    const { mb } = await seedMailbox(db, OWNER);
    await db.execute(sql`
      INSERT INTO mail_messages
        (mailbox_account_id, provider_message_id, provider_thread_id, sender_key,
         internal_date, label_ids, is_unread)
      SELECT ${mb}::uuid, 'm-' || g, 't-' || g, 'k' || (g % 50), now(), ARRAY['INBOX'], false
      FROM generate_series(1, 5000) AS g
    `);
    await seedMessage(db, mb, { id: 'draft-1', from: OWNER, labelIds: ['DRAFT'], at: day(1) });
    await db.execute(sql`ANALYZE mail_messages`);

    const plan = await db.execute(
      sql`EXPLAIN ${nonMailBatchDelete(db, mb, NON_MAIL_PURGE_BATCH).getSQL()}`,
    );
    const rows = ((plan as unknown as { rows?: unknown[] }).rows ?? plan) as Array<
      Record<string, string>
    >;

    expect(rows.map((row) => row['QUERY PLAN']).join('\n')).toContain('mail_messages_non_mail_idx');
  });
});
