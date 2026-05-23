import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  mailMessages,
  mailboxAccounts,
  schema,
  senderPolicies,
  senderTimeseries,
  senders,
  triageDecisions,
  users,
  workspaces,
} from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { SendersReadService } from './senders.read-service.js';

/**
 * SendersReadService integration tests (D39, D40, D44, D45, D46).
 *
 * Runs the real service against an in-process PGlite database with
 * every migration applied — covers the per-endpoint SELECTs that
 * back the FE's Sender Detail page (PR #30).
 *
 * The tests intentionally cover BEHAVIOR (cursor round-trip, tenant
 * isolation, ordering, +1 sentinel) rather than internals. A failure
 * here is a contract regression on the wire shape the FE consumes.
 */

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'migrations',
);

type Db = ReturnType<typeof drizzle<typeof schema>>;

async function freshDb(): Promise<Db> {
  const pg = new PGlite({ extensions: { citext } });
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sqlText = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sqlText.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await pg.query(trimmed);
      }
    }
  }
  return drizzle(pg, { schema });
}

async function seedMailbox(db: Db, label: string): Promise<string> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS-${label}` })
    .returning({
      id: workspaces.id,
    });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: `${label}@declutrmail.ai` })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: `${label}@declutrmail.ai`,
    })
    .returning({ id: mailboxAccounts.id });
  return mailbox!.id;
}

/** Build the canonical D12 sender_key for an email (sha256("v1|" + lower)). */
function senderKeyFor(email: string): string {
  return createHash('sha256').update(`v1|${email.toLowerCase()}`).digest('hex');
}

interface SeedSenderArgs {
  mailboxAccountId: string;
  email: string;
  displayName?: string;
  category?: 'primary' | 'promotions' | 'social' | 'updates' | 'forums';
  lastSeenAt: Date;
  firstSeenAt?: Date;
  unsubscribeMethod?: 'one_click' | 'mailto' | 'none' | null;
}

async function seedSender(
  db: Db,
  args: SeedSenderArgs,
): Promise<{ id: string; senderKey: string }> {
  const senderKey = senderKeyFor(args.email);
  const [row] = await db
    .insert(senders)
    .values({
      mailboxAccountId: args.mailboxAccountId,
      senderKey,
      displayName: args.displayName ?? '',
      email: args.email,
      domain: args.email.split('@')[1] ?? '',
      gmailCategory: args.category ?? 'updates',
      firstSeenAt: args.firstSeenAt ?? args.lastSeenAt,
      lastSeenAt: args.lastSeenAt,
      ...(args.unsubscribeMethod ? { unsubscribeMethod: args.unsubscribeMethod } : {}),
    })
    .returning({ id: senders.id });
  return { id: row!.id, senderKey };
}

async function seedMessage(
  db: Db,
  args: {
    mailboxAccountId: string;
    senderKey: string;
    internalDate: Date;
    subject?: string;
    snippet?: string;
    isUnread?: boolean;
    providerMessageId?: string;
  },
): Promise<string> {
  const providerMessageId = args.providerMessageId ?? `pmid-${randomUUID()}`;
  const [row] = await db
    .insert(mailMessages)
    .values({
      mailboxAccountId: args.mailboxAccountId,
      providerMessageId,
      providerThreadId: `thr-${providerMessageId}`,
      senderKey: args.senderKey,
      subject: args.subject ?? 'Test',
      snippet: args.snippet ?? '',
      internalDate: args.internalDate,
      isUnread: args.isUnread ?? false,
    })
    .returning({ id: mailMessages.id });
  return row!.id;
}

async function seedTimeseries(
  db: Db,
  args: {
    mailboxAccountId: string;
    senderKey: string;
    yearMonth: string; // YYYY-MM-DD (first of month)
    volume: number;
    readCount: number;
  },
): Promise<void> {
  await db.insert(senderTimeseries).values({
    mailboxAccountId: args.mailboxAccountId,
    senderKey: args.senderKey,
    yearMonth: args.yearMonth,
    volume: args.volume,
    readCount: args.readCount,
  });
}

describe('SendersReadService', () => {
  let db: Db;
  let mailboxId: string;
  let svc: SendersReadService;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db, 'a');
    svc = new SendersReadService(db as never);
  });

  describe('listSenders', () => {
    it('returns rows ordered by last_seen_at DESC and supports cursor round-trip', async () => {
      // Seed three senders with strictly distinct last_seen_at so the
      // ordering is deterministic without relying on the id tie-break.
      const a = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'a@x.com',
        lastSeenAt: new Date('2026-01-01T00:00:00Z'),
      });
      const b = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'b@x.com',
        lastSeenAt: new Date('2026-02-01T00:00:00Z'),
      });
      const c = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'c@x.com',
        lastSeenAt: new Date('2026-03-01T00:00:00Z'),
      });

      // Page 1 — limit 2; +1 sentinel from the service tells the
      // caller "more rows exist". Newest first: c, b.
      const page1 = await svc.listSenders({
        mailboxAccountId: mailboxId,
        category: null,
        cursor: null,
        limit: 2,
      });
      expect(page1.length).toBe(3); // limit + sentinel
      expect(page1.slice(0, 2).map((r) => r.id)).toEqual([c.id, b.id]);

      // Page 2 — start after b (the last item on page 1).
      const page2 = await svc.listSenders({
        mailboxAccountId: mailboxId,
        category: null,
        cursor: { lastSeenAt: new Date('2026-02-01T00:00:00Z'), id: b.id },
        limit: 2,
      });
      // Only `a` is left — no sentinel.
      expect(page2.length).toBe(1);
      expect(page2[0]!.id).toBe(a.id);
    });

    it('filters by gmail category when provided', async () => {
      await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'promo@x.com',
        category: 'promotions',
        lastSeenAt: new Date('2026-01-01T00:00:00Z'),
      });
      const primary = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'real@x.com',
        category: 'primary',
        lastSeenAt: new Date('2026-02-01T00:00:00Z'),
      });

      const rows = await svc.listSenders({
        mailboxAccountId: mailboxId,
        category: 'primary',
        cursor: null,
        limit: 25,
      });
      expect(rows.length).toBe(1);
      expect(rows[0]!.id).toBe(primary.id);
      expect(rows[0]!.gmailCategory).toBe('primary');
    });

    it('isolates senders by mailbox (tenant safety)', async () => {
      const otherMailbox = await seedMailbox(db, 'other');
      await seedSender(db, {
        mailboxAccountId: otherMailbox,
        email: 'mine@x.com',
        lastSeenAt: new Date('2026-01-01T00:00:00Z'),
      });
      const rows = await svc.listSenders({
        mailboxAccountId: mailboxId,
        category: null,
        cursor: null,
        limit: 25,
      });
      expect(rows).toEqual([]);
    });

    it('fills monthlyVolume + readRate from the latest timeseries row', async () => {
      const a = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'metrics@x.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      // Older month — should NOT win.
      await seedTimeseries(db, {
        mailboxAccountId: mailboxId,
        senderKey: a.senderKey,
        yearMonth: '2026-04-01',
        volume: 5,
        readCount: 1,
      });
      // Latest month — wins.
      await seedTimeseries(db, {
        mailboxAccountId: mailboxId,
        senderKey: a.senderKey,
        yearMonth: '2026-05-01',
        volume: 20,
        readCount: 5,
      });

      const rows = await svc.listSenders({
        mailboxAccountId: mailboxId,
        category: null,
        cursor: null,
        limit: 10,
      });
      expect(rows[0]!.monthlyVolume).toBe(20);
      expect(rows[0]!.readRate).toBe(0.25);
    });

    it('returns null monthlyVolume + readRate when no timeseries rows exist', async () => {
      await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'no-ts@x.com',
        lastSeenAt: new Date('2026-01-01T00:00:00Z'),
      });
      const rows = await svc.listSenders({
        mailboxAccountId: mailboxId,
        category: null,
        cursor: null,
        limit: 10,
      });
      expect(rows[0]!.monthlyVolume).toBeNull();
      expect(rows[0]!.readRate).toBeNull();
    });
  });

  describe('getSenderDetail', () => {
    it('returns the sender with policy flags when both exist', async () => {
      const a = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'detail@x.com',
        displayName: 'Detail Sender',
        category: 'promotions',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        firstSeenAt: new Date('2024-01-01T00:00:00Z'),
      });
      const protectedAt = new Date('2026-04-10T00:00:00Z');
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxId,
        senderKey: a.senderKey,
        policyType: 'keep',
        isVip: true,
        isProtected: true,
        protectionReason: 'user_defined',
        protectionSetAt: protectedAt,
      });

      const detail = await svc.getSenderDetail(mailboxId, a.id);
      expect(detail).not.toBeNull();
      expect(detail!.displayName).toBe('Detail Sender');
      expect(detail!.gmailCategory).toBe('promotions');
      expect(detail!.firstSeenAt).toBe('2024-01-01T00:00:00.000Z');
      expect(detail!.protectionFlags).toEqual({
        isVip: true,
        isProtected: true,
        protectionReason: 'user_defined',
        protectionSetAt: protectedAt.toISOString(),
      });
    });

    it('defaults protection flags when no sender_policies row exists', async () => {
      const a = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'no-policy@x.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      const detail = await svc.getSenderDetail(mailboxId, a.id);
      expect(detail!.protectionFlags).toEqual({
        isVip: false,
        isProtected: false,
        protectionReason: null,
        protectionSetAt: null,
      });
    });

    it('returns null for a sender that belongs to a different mailbox', async () => {
      const other = await seedMailbox(db, 'other');
      const a = await seedSender(db, {
        mailboxAccountId: other,
        email: 'other@x.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      const detail = await svc.getSenderDetail(mailboxId, a.id);
      expect(detail).toBeNull();
    });
  });

  describe('listMessagesForSender', () => {
    it('orders by internal_date DESC and respects the +1 sentinel', async () => {
      const a = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'msgs@x.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      await seedMessage(db, {
        mailboxAccountId: mailboxId,
        senderKey: a.senderKey,
        internalDate: new Date('2026-04-01T00:00:00Z'),
      });
      await seedMessage(db, {
        mailboxAccountId: mailboxId,
        senderKey: a.senderKey,
        internalDate: new Date('2026-05-01T00:00:00Z'),
      });
      await seedMessage(db, {
        mailboxAccountId: mailboxId,
        senderKey: a.senderKey,
        internalDate: new Date('2026-03-01T00:00:00Z'),
      });

      const rows = await svc.listMessagesForSender({
        mailboxAccountId: mailboxId,
        senderId: a.id,
        cursor: null,
        limit: 2,
      });
      expect(rows).not.toBeNull();
      // limit 2 + sentinel = 3 rows; newest first.
      expect(rows!.length).toBe(3);
      expect(rows!.map((r) => r.internalDate)).toEqual([
        '2026-05-01T00:00:00.000Z',
        '2026-04-01T00:00:00.000Z',
        '2026-03-01T00:00:00.000Z',
      ]);
    });

    it('returns null when the sender belongs to a different mailbox', async () => {
      const other = await seedMailbox(db, 'other');
      const a = await seedSender(db, {
        mailboxAccountId: other,
        email: 'cross@x.com',
        lastSeenAt: new Date('2026-01-01T00:00:00Z'),
      });
      const rows = await svc.listMessagesForSender({
        mailboxAccountId: mailboxId,
        senderId: a.id,
        cursor: null,
        limit: 10,
      });
      expect(rows).toBeNull();
    });

    it('does not return messages from a different sender', async () => {
      const a = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'me@x.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      const b = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'other@x.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      await seedMessage(db, {
        mailboxAccountId: mailboxId,
        senderKey: a.senderKey,
        internalDate: new Date('2026-05-01T00:00:00Z'),
        subject: 'from-a',
      });
      await seedMessage(db, {
        mailboxAccountId: mailboxId,
        senderKey: b.senderKey,
        internalDate: new Date('2026-05-01T00:00:00Z'),
        subject: 'from-b',
      });
      const rows = await svc.listMessagesForSender({
        mailboxAccountId: mailboxId,
        senderId: a.id,
        cursor: null,
        limit: 10,
      });
      expect(rows!.length).toBe(1);
      expect(rows![0]!.subject).toBe('from-a');
    });

    it('paginates via cursor', async () => {
      const a = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'page@x.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      for (let i = 0; i < 5; i += 1) {
        // 5 messages spread by day so internalDate is unique.
        await seedMessage(db, {
          mailboxAccountId: mailboxId,
          senderKey: a.senderKey,
          internalDate: new Date(`2026-05-0${i + 1}T00:00:00Z`),
        });
      }
      const page1 = await svc.listMessagesForSender({
        mailboxAccountId: mailboxId,
        senderId: a.id,
        cursor: null,
        limit: 2,
      });
      expect(page1!.length).toBe(3); // 2 + sentinel
      const lastOfPage1 = page1![1]!;
      const page2 = await svc.listMessagesForSender({
        mailboxAccountId: mailboxId,
        senderId: a.id,
        cursor: {
          internalDate: new Date(lastOfPage1.internalDate),
          id: lastOfPage1.id,
        },
        limit: 2,
      });
      // Three messages remain below the boundary; 2 + sentinel = 3.
      expect(page2!.length).toBe(3);
      // No overlap with page1.
      const page1Ids = page1!.slice(0, 2).map((r) => r.id);
      for (const row of page2!.slice(0, 2)) {
        expect(page1Ids).not.toContain(row.id);
      }
    });
  });

  describe('listTimeseries', () => {
    it('returns rows within the 12-month window in chronological order', async () => {
      const a = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'ts@x.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      // Anchor "now" at 2026-05-15 → window starts 2025-06-01.
      // Seed: one OUT of window (2025-05) + a sparse set inside it.
      await seedTimeseries(db, {
        mailboxAccountId: mailboxId,
        senderKey: a.senderKey,
        yearMonth: '2025-05-01',
        volume: 99,
        readCount: 0,
      });
      await seedTimeseries(db, {
        mailboxAccountId: mailboxId,
        senderKey: a.senderKey,
        yearMonth: '2025-06-01',
        volume: 5,
        readCount: 2,
      });
      await seedTimeseries(db, {
        mailboxAccountId: mailboxId,
        senderKey: a.senderKey,
        yearMonth: '2026-01-01',
        volume: 10,
        readCount: 3,
      });
      await seedTimeseries(db, {
        mailboxAccountId: mailboxId,
        senderKey: a.senderKey,
        yearMonth: '2026-05-01',
        volume: 20,
        readCount: 5,
      });

      const points = await svc.listTimeseries({
        mailboxAccountId: mailboxId,
        senderId: a.id,
        now: new Date('2026-05-15T00:00:00Z'),
      });
      expect(points).not.toBeNull();
      // 2025-05 falls outside the window; the rest are present in order.
      expect(points!.map((p) => p.yearMonth)).toEqual(['2025-06', '2026-01', '2026-05']);
      expect(points!.find((p) => p.yearMonth === '2026-05')!.volume).toBe(20);
      expect(points!.find((p) => p.yearMonth === '2026-05')!.readCount).toBe(5);
    });

    it('returns an empty array (not null) when the sender has no timeseries rows', async () => {
      const a = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'empty-ts@x.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      const points = await svc.listTimeseries({
        mailboxAccountId: mailboxId,
        senderId: a.id,
      });
      expect(points).toEqual([]);
    });

    it('returns null when the sender belongs to a different mailbox', async () => {
      const other = await seedMailbox(db, 'other');
      const a = await seedSender(db, {
        mailboxAccountId: other,
        email: 'cross@x.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      const points = await svc.listTimeseries({
        mailboxAccountId: mailboxId,
        senderId: a.id,
      });
      expect(points).toBeNull();
    });
  });

  describe('listDecisionHistory', () => {
    it('returns the current decision row ordered by produced_at DESC', async () => {
      const a = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'history@x.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      // Schema enforces ONE row per (mailbox, sender), so only one
      // decision lives at a time — pagination is forward-compat.
      const producedAt = new Date('2026-05-15T12:00:00Z');
      await db.insert(triageDecisions).values({
        mailboxAccountId: mailboxId,
        senderKey: a.senderKey,
        verdict: 'archive',
        confidence: '0.92',
        reasoning: 'High volume, near-zero read rate.',
        generatedBy: 'template',
        producedAt,
        expiresAt: new Date('2026-06-01T00:00:00Z'),
      });

      const rows = await svc.listDecisionHistory({
        mailboxAccountId: mailboxId,
        senderId: a.id,
        cursor: null,
        limit: 10,
      });
      expect(rows).not.toBeNull();
      expect(rows!.length).toBe(1);
      expect(rows![0]!.verdict).toBe('archive');
      expect(rows![0]!.confidence).toBe(0.92);
      expect(rows![0]!.producedAt).toBe(producedAt.toISOString());
      expect(rows![0]!.generatedBy).toBe('template');
      expect(rows![0]!.reasoning).toContain('volume');
    });

    it('returns null when the sender belongs to a different mailbox', async () => {
      const other = await seedMailbox(db, 'other');
      const a = await seedSender(db, {
        mailboxAccountId: other,
        email: 'cross@x.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      const rows = await svc.listDecisionHistory({
        mailboxAccountId: mailboxId,
        senderId: a.id,
        cursor: null,
        limit: 10,
      });
      expect(rows).toBeNull();
    });

    it('returns an empty array (not null) when no decision row exists yet', async () => {
      const a = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'no-history@x.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      const rows = await svc.listDecisionHistory({
        mailboxAccountId: mailboxId,
        senderId: a.id,
        cursor: null,
        limit: 10,
      });
      expect(rows).toEqual([]);
    });
  });
});
