import { mailMessages, schema, senders, triageDecisions } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { and, eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  expireUnbackedPrimaryKeeps,
  messageGmailCategory,
  reconcileSenderCategories,
  rowsOf,
  senderGmailCategory,
  type LabelledGmailCategory,
} from './gmail-category.js';

/**
 * Gmail's tab labels are the only evidence of a sender's tab. A message
 * without one says nothing, so it must never count as Primary — that
 * default kept 1,552 senders at 95% on one production mailbox with no
 * Primary label behind them (2026-09-25).
 */
describe('messageGmailCategory', () => {
  it('reads the tab from Gmail’s own label', () => {
    expect(messageGmailCategory(['INBOX', 'CATEGORY_PERSONAL'])).toBe('primary');
    expect(messageGmailCategory(['CATEGORY_PROMOTIONS', 'UNREAD'])).toBe('promotions');
    expect(messageGmailCategory(['CATEGORY_FORUMS'])).toBe('forums');
  });

  it('returns null — not primary — when Gmail put no tab label on the message', () => {
    expect(messageGmailCategory(['INBOX', 'UNREAD'])).toBeNull();
    expect(messageGmailCategory(['CHAT'])).toBeNull();
    expect(messageGmailCategory([])).toBeNull();
  });
});

describe('senderGmailCategory', () => {
  const counts = (entries: [LabelledGmailCategory, number][]) => new Map(entries);

  it('is unknown when none of the sender’s mail carries a tab label', () => {
    expect(senderGmailCategory(counts([]))).toBe('unknown');
  });

  it('is the tab MORE than half of the labelled mail carries', () => {
    expect(
      senderGmailCategory(
        counts([
          ['primary', 3],
          ['promotions', 1],
        ]),
      ),
    ).toBe('primary');
    expect(senderGmailCategory(counts([['promotions', 1]]))).toBe('promotions');
  });

  it('is unknown on a tie — "Gmail puts them in Primary" is not backed by half', () => {
    // The old tie-break handed every tie to Primary.
    expect(
      senderGmailCategory(
        counts([
          ['primary', 1],
          ['promotions', 1],
        ]),
      ),
    ).toBe('unknown');
  });

  it('is unknown when no tab holds a majority', () => {
    expect(
      senderGmailCategory(
        counts([
          ['primary', 2],
          ['promotions', 2],
          ['updates', 1],
        ]),
      ),
    ).toBe('unknown');
  });
});

describe('rowsOf', () => {
  it('reads both driver shapes', () => {
    // postgres.js returns an array-like; PGlite `{ rows }`.
    expect(rowsOf([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(rowsOf({ rows: [{ a: 1 }] })).toEqual([{ a: 1 }]);
  });

  it('throws on any other shape — "no rows" would skip every re-score', () => {
    expect(() => rowsOf({ count: 3 })).toThrow(/unrecognised driver result shape/);
    expect(() => rowsOf(null)).toThrow(/unrecognised driver result shape/);
  });
});

type Db = ReturnType<typeof drizzle<typeof schema>>;
const DAY = 86_400_000;

describe('reconcileSenderCategories', () => {
  let db: Db;
  let mailboxId: string;
  let msgSeq = 0;

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
        providerAccountId: 'o@ex.com',
      })
      .returning({ id: schema.mailboxAccounts.id });
    mailboxId = mb!.id;
  });

  async function seedSender(
    senderKey: string,
    stored: (typeof schema.gmailCategory.enumValues)[number],
    labelSets: string[][],
    opts: { isOutbound?: boolean; unsubscribeUrl?: string } = {},
  ): Promise<void> {
    await db.insert(senders).values({
      mailboxAccountId: mailboxId,
      senderKey,
      email: `${senderKey}@ex.com`,
      domain: 'ex.com',
      gmailCategory: stored,
      firstSeenAt: new Date(Date.now() - 30 * DAY),
      lastSeenAt: new Date(Date.now() - DAY),
    });
    for (const labelIds of labelSets) {
      msgSeq += 1;
      await db.insert(mailMessages).values({
        mailboxAccountId: mailboxId,
        providerMessageId: `m${msgSeq}`,
        providerThreadId: `t${msgSeq}`,
        senderKey,
        subject: 's',
        snippet: '',
        internalDate: new Date(Date.now() - 2 * DAY),
        labelIds,
        isUnread: false,
        isOutbound: opts.isOutbound ?? false,
        ...(opts.unsubscribeUrl ? { unsubscribeUrl: opts.unsubscribeUrl } : {}),
      });
    }
  }

  async function categoryOf(senderKey: string) {
    const [row] = await db
      .select({ c: senders.gmailCategory })
      .from(senders)
      .where(and(eq(senders.mailboxAccountId, mailboxId), eq(senders.senderKey, senderKey)));
    return row?.c;
  }

  const reconcile = () => db.transaction((tx) => reconcileSenderCategories(tx as never, mailboxId));

  it('rewrites a Primary that no label backs to unknown, and reports it', async () => {
    // The row the old "no label → primary" default wrote.
    await seedSender('guessed', 'primary', [['INBOX'], ['INBOX', 'UNREAD'], ['CHAT']]);

    const changed = await reconcile();

    expect(changed).toEqual(['guessed']);
    expect(await categoryOf('guessed')).toBe('unknown');
  });

  it('adopts the labelled majority once Gmail files the mail', async () => {
    // First message arrived unlabelled; later ones landed in Promotions.
    await seedSender('late-labelled', 'unknown', [
      ['INBOX'],
      ['INBOX', 'CATEGORY_PROMOTIONS'],
      ['INBOX', 'CATEGORY_PROMOTIONS'],
    ]);

    expect(await reconcile()).toEqual(['late-labelled']);
    expect(await categoryOf('late-labelled')).toBe('promotions');
  });

  it('ignores unlabelled mail when counting — it no longer outvotes a real label', async () => {
    // Old rule: 3 unlabelled "primary" votes beat 1 Promotions.
    await seedSender('outvoted', 'primary', [
      ['INBOX'],
      ['INBOX'],
      ['INBOX'],
      ['INBOX', 'CATEGORY_PROMOTIONS'],
    ]);

    await reconcile();

    expect(await categoryOf('outvoted')).toBe('promotions');
  });

  it('keeps a genuine Primary sender and does not report it', async () => {
    await seedSender('person', 'primary', [
      ['INBOX', 'CATEGORY_PERSONAL'],
      ['INBOX', 'CATEGORY_PERSONAL'],
      ['INBOX'],
    ]);

    expect(await reconcile()).toEqual([]);
    expect(await categoryOf('person')).toBe('primary');
  });

  it('never counts the user’s own sent mail toward a sender’s tab', async () => {
    await seedSender('sent-only-labels', 'primary', [['INBOX']]);
    // Outbound rows stored under the same key must not vote.
    msgSeq += 1;
    await db.insert(mailMessages).values({
      mailboxAccountId: mailboxId,
      providerMessageId: `m${msgSeq}`,
      providerThreadId: `t${msgSeq}`,
      senderKey: 'sent-only-labels',
      subject: 's',
      snippet: '',
      internalDate: new Date(),
      labelIds: ['SENT', 'CATEGORY_PERSONAL'],
      isUnread: false,
      isOutbound: true,
    });

    await reconcile();

    expect(await categoryOf('sent-only-labels')).toBe('unknown');
  });

  it('marks the changed sender’s decision expired, so its Primary explanation is rewritten', async () => {
    await seedSender('guessed', 'primary', [['INBOX']]);
    await seedSender('person', 'primary', [['INBOX', 'CATEGORY_PERSONAL']]);
    const future = new Date(Date.now() + 5 * DAY);
    for (const senderKey of ['guessed', 'person']) {
      await db.insert(triageDecisions).values({
        mailboxAccountId: mailboxId,
        senderKey,
        verdict: 'keep',
        confidence: '0.95',
        reasoning: 'Kept because Gmail puts them in your Primary inbox.',
        generatedBy: 'llm_haiku',
        expiresAt: future,
      });
    }

    await reconcile();

    const rows = await db
      .select({ senderKey: triageDecisions.senderKey, expiresAt: triageDecisions.expiresAt })
      .from(triageDecisions);
    const expiry = new Map(rows.map((r) => [r.senderKey, r.expiresAt.getTime()]));
    expect(expiry.get('guessed')!).toBeLessThanOrEqual(Date.now());
    // Untouched: its category did not move, so its explanation still holds.
    expect(expiry.get('person')).toBe(future.getTime());
  });

  describe('expireUnbackedPrimaryKeeps', () => {
    /** A decision exactly as rule 3 (the Primary Keep) wrote it, still unexpired. */
    async function decide(senderKey: string, confidence = '0.95'): Promise<void> {
      await db.insert(triageDecisions).values({
        mailboxAccountId: mailboxId,
        senderKey,
        verdict: 'keep',
        confidence,
        reasoning: 'Kept because Gmail puts them in your Primary inbox.',
        generatedBy: 'template',
        expiresAt: new Date(Date.now() + 5 * DAY),
      });
    }
    async function marked(senderKey: string) {
      const [row] = await db
        .select({ p: triageDecisions.producedAt, e: triageDecisions.expiresAt })
        .from(triageDecisions)
        .where(eq(triageDecisions.senderKey, senderKey));
      return row!.e.getTime() === row!.p.getTime();
    }
    const expire = () => db.transaction((tx) => expireUnbackedPrimaryKeeps(tx as never, mailboxId));

    it('marks a Primary Keep whose sender offers an unsubscribe link — the rule no longer backs it', async () => {
      await seedSender('primary-newsletter', 'primary', [['INBOX', 'CATEGORY_PERSONAL']], {
        unsubscribeUrl: 'https://brand.test/unsub',
      });
      await decide('primary-newsletter');

      expect(await expire()).toBe(1);
      expect(await marked('primary-newsletter')).toBe(true);
    });

    it('leaves a Primary Keep with no unsubscribe link, and any other Keep, alone', async () => {
      await seedSender('person', 'primary', [['INBOX', 'CATEGORY_PERSONAL']]);
      await decide('person');
      // Written-to Keep (0.98) with a channel: not rule 3, not this pass's business.
      await seedSender('wrote-to', 'primary', [['INBOX', 'CATEGORY_PERSONAL']], {
        unsubscribeUrl: 'https://brand.test/unsub',
      });
      await decide('wrote-to', '0.98');

      expect(await expire()).toBe(0);
      expect(await marked('person')).toBe(false);
      expect(await marked('wrote-to')).toBe(false);
    });

    it('marks a Primary Keep whose sender is no longer stored as Primary', async () => {
      await seedSender('was-primary', 'unknown', [['INBOX']]);
      await decide('was-primary');

      expect(await expire()).toBe(1);
      expect(await marked('was-primary')).toBe(true);
    });
  });

  it('is a no-op on a second run', async () => {
    await seedSender('guessed', 'primary', [['INBOX']]);
    await reconcile();
    expect(await reconcile()).toEqual([]);
  });
});
