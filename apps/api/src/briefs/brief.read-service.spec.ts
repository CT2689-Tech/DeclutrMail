import {
  briefRuns,
  type BriefPayload as PersistedBriefPayload,
  mailboxAccounts,
  productFeedback,
  schema,
  senderPolicies,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { BriefReadService } from './brief.read-service.js';
import type { BriefPayload } from './brief.types.js';

/**
 * BriefReadService integration tests (D61, D69, D70).
 *
 * Runs the real service against in-process PGlite with every migration
 * applied. Covers tenant isolation, date-range filtering, the D61
 * first-view tracker (`markOpened`), and input validation.
 */

type Db = ReturnType<typeof drizzle<typeof schema>>;

async function freshDb(): Promise<Db> {
  return freshTestDb();
}

async function seedMailbox(
  db: Db,
  email: string,
): Promise<{ workspaceId: string; userId: string; mailboxAccountId: string }> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS-${email}` })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email })
    .returning({ id: users.id });
  const [mb] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: email,
    })
    .returning({ id: mailboxAccounts.id });
  return { workspaceId: ws!.id, userId: user!.id, mailboxAccountId: mb!.id };
}

const SAMPLE_PAYLOAD: BriefPayload = {
  reply: [
    {
      senderKey: 'a'.repeat(64),
      senderName: 'Boss',
      senderEmail: 'boss@example.com',
      subject: 'Q4 plans',
      messageIds: ['gmail-1'],
    },
  ],
  fyi: [],
  noise: [],
  narrative: 'One email needs a reply.',
};

async function seedBrief(
  db: Db,
  workspaceId: string,
  mailboxAccountId: string,
  runDateLocal: string,
  opts: { openedAt?: Date | null; payload?: BriefPayload } = {},
): Promise<string> {
  const [row] = await db
    .insert(briefRuns)
    .values({
      workspaceId,
      mailboxAccountId,
      runDateLocal,
      generatedBy: 'template',
      briefPayload: (opts.payload ?? SAMPLE_PAYLOAD) as unknown as PersistedBriefPayload,
      ...(opts.openedAt !== undefined ? { openedAt: opts.openedAt } : {}),
    })
    .returning({ id: briefRuns.id });
  return row!.id;
}

/** A Noise-only payload whose senders the D65 resolution has to find. */
function noisePayload(groups: Array<{ senderKey: string; senderName: string }>): BriefPayload {
  return {
    reply: [],
    fyi: [],
    noise: groups.map((g) => ({
      senderKey: g.senderKey,
      senderName: g.senderName,
      messageCount: 3,
      messageIds: ['gmail-x', 'gmail-y', 'gmail-z'],
    })),
    narrative: 'Three newsletters.',
  };
}

async function seedSender(
  db: Db,
  mailboxAccountId: string,
  senderKey: string,
  email: string,
): Promise<string> {
  const [row] = await db
    .insert(senders)
    .values({
      mailboxAccountId,
      senderKey,
      displayName: email,
      email,
      domain: email.split('@')[1]!,
      gmailCategory: 'promotions',
      firstSeenAt: new Date('2026-01-01T00:00:00Z'),
      lastSeenAt: new Date('2026-05-24T00:00:00Z'),
    })
    .returning({ id: senders.id });
  return row!.id;
}

async function protectSender(db: Db, mailboxAccountId: string, senderKey: string): Promise<void> {
  await db.insert(senderPolicies).values({
    mailboxAccountId,
    senderKey,
    isProtected: true,
    protectionReason: 'replied',
    protectionSetAt: new Date('2026-05-01T00:00:00Z'),
  });
}

describe('BriefReadService', () => {
  let db: Db;
  let service: BriefReadService;
  let mailboxA: { workspaceId: string; userId: string; mailboxAccountId: string };
  let mailboxB: { workspaceId: string; userId: string; mailboxAccountId: string };

  beforeEach(async () => {
    db = await freshDb();
    service = new BriefReadService(db as never);
    mailboxA = await seedMailbox(db, 'a@example.com');
    mailboxB = await seedMailbox(db, 'b@example.com');
  });

  describe('getForDate', () => {
    it('returns the brief when it exists', async () => {
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-25');
      const brief = await service.getForDate(mailboxA.mailboxAccountId, '2026-05-25');
      expect(brief).not.toBeNull();
      expect(brief!.runDateLocal).toBe('2026-05-25');
      expect(brief!.generatedBy).toBe('template');
      expect(brief!.briefPayload.reply).toHaveLength(1);
      expect(brief!.briefPayload.reply[0]!.senderName).toBe('Boss');
    });

    it('carries the pre-cap section totals through to the wire', async () => {
      // projectBrief is a deliberate field allowlist — that is what
      // keeps a stowaway snippet off the wire (D7). It also means a new
      // payload field is silently dropped unless it is named there, and
      // neither the worker test (which asserts the DB row) nor the
      // screen test (which stubs the response) can see that gap. This
      // is the join.
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-25', {
        payload: { ...SAMPLE_PAYLOAD, replyTotal: 8, fyiTotal: 5 },
      });

      const brief = await service.getForDate(mailboxA.mailboxAccountId, '2026-05-25');

      expect(brief!.briefPayload.replyTotal).toBe(8);
      expect(brief!.briefPayload.fyiTotal).toBe(5);
    });

    it('omits the totals for a Brief frozen before they existed', async () => {
      // D69 freezes each row, so payloads without the field are a real
      // shape the projection must pass through as absent — not as 0,
      // which the screen would read as "everything was truncated".
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-25');

      const brief = await service.getForDate(mailboxA.mailboxAccountId, '2026-05-25');

      expect(brief!.briefPayload.replyTotal).toBeUndefined();
      expect(brief!.briefPayload.fyiTotal).toBeUndefined();
    });

    it('projects the current user rating for the frozen Brief', async () => {
      const briefId = await seedBrief(
        db,
        mailboxA.workspaceId,
        mailboxA.mailboxAccountId,
        '2026-05-25',
      );
      await db.insert(productFeedback).values({
        workspaceId: mailboxA.workspaceId,
        userId: mailboxA.userId,
        mailboxAccountId: mailboxA.mailboxAccountId,
        surface: 'brief',
        rating: 'wrong_reason',
        briefRunId: briefId,
      });

      const brief = await service.getForDate(
        mailboxA.mailboxAccountId,
        '2026-05-25',
        mailboxA.userId,
      );
      expect(brief!.feedbackRating).toBe('wrong_reason');
    });

    it('returns null when no brief exists for the date', async () => {
      const brief = await service.getForDate(mailboxA.mailboxAccountId, '2026-05-25');
      expect(brief).toBeNull();
    });

    it('does not leak briefs across tenants', async () => {
      await seedBrief(db, mailboxB.workspaceId, mailboxB.mailboxAccountId, '2026-05-25');
      const brief = await service.getForDate(mailboxA.mailboxAccountId, '2026-05-25');
      expect(brief).toBeNull();
    });

    it('rejects an invalid date format', async () => {
      await expect(
        service.getForDate(mailboxA.mailboxAccountId, '2026/05/25'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.getForDate(mailboxA.mailboxAccountId, 'today')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('listByRange', () => {
    it('returns briefs in the [from, to] inclusive range, newest first', async () => {
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-20');
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-22');
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-24');
      // Outside range
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-15');
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-30');

      const list = await service.listByRange(mailboxA.mailboxAccountId, '2026-05-20', '2026-05-24');
      expect(list.map((b) => b.runDateLocal)).toEqual(['2026-05-24', '2026-05-22', '2026-05-20']);
    });

    it('rejects malformed dates', async () => {
      await expect(
        service.listByRange(mailboxA.mailboxAccountId, '2026/05/20', '2026-05-24'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects from > to', async () => {
      await expect(
        service.listByRange(mailboxA.mailboxAccountId, '2026-05-25', '2026-05-20'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does not leak briefs across tenants', async () => {
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-25');
      await seedBrief(db, mailboxB.workspaceId, mailboxB.mailboxAccountId, '2026-05-25');
      const a = await service.listByRange(mailboxA.mailboxAccountId, '2026-05-01', '2026-05-31');
      const b = await service.listByRange(mailboxB.mailboxAccountId, '2026-05-01', '2026-05-31');
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      expect(a[0]!.id).not.toBe(b[0]!.id);
    });
  });

  describe('markOpened — D61 first-view tracker', () => {
    it('sets opened_at on first call', async () => {
      const id = await seedBrief(
        db,
        mailboxA.workspaceId,
        mailboxA.mailboxAccountId,
        '2026-05-25',
        { openedAt: null },
      );
      const result = await service.markOpened(mailboxA.mailboxAccountId, id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(id);
      expect(typeof result!.openedAt).toBe('string');

      const [row] = await db
        .select({ openedAt: briefRuns.openedAt })
        .from(briefRuns)
        .where(eq(briefRuns.id, id));
      expect(row!.openedAt).not.toBeNull();
    });

    it('second call returns the existing opened_at (idempotent)', async () => {
      const id = await seedBrief(
        db,
        mailboxA.workspaceId,
        mailboxA.mailboxAccountId,
        '2026-05-25',
        { openedAt: null },
      );
      const first = await service.markOpened(mailboxA.mailboxAccountId, id);
      expect(first).not.toBeNull();
      // Wait a tick so a second `now()` would differ from the first.
      await new Promise((r) => setTimeout(r, 10));
      const second = await service.markOpened(mailboxA.mailboxAccountId, id);
      expect(second).not.toBeNull();
      expect(second!.openedAt).toBe(first!.openedAt);

      const [row] = await db
        .select({ openedAt: briefRuns.openedAt })
        .from(briefRuns)
        .where(eq(briefRuns.id, id));
      // Persisted value matches the first-time set.
      expect(row!.openedAt!.toISOString()).toBe(first!.openedAt);
    });

    it('returns null on cross-tenant attempts', async () => {
      const id = await seedBrief(db, mailboxB.workspaceId, mailboxB.mailboxAccountId, '2026-05-25');
      const result = await service.markOpened(mailboxA.mailboxAccountId, id);
      expect(result).toBeNull();
    });

    it('returns null for unknown id', async () => {
      const result = await service.markOpened(
        mailboxA.mailboxAccountId,
        '00000000-0000-0000-0000-000000000000',
      );
      expect(result).toBeNull();
    });
  });

  /**
   * D65 — the archive targets behind the Noise section. Every case here
   * is a way the join could hand a bulk action the wrong sender, or hide
   * a sender the Brief promised.
   */
  describe('noiseSenders (D65)', () => {
    const KEY_NEWS = 'n'.repeat(64);
    const KEY_SHOP = 's'.repeat(64);
    const KEY_GONE = 'g'.repeat(64);

    it('resolves each Noise group to its sender id', async () => {
      const newsId = await seedSender(db, mailboxA.mailboxAccountId, KEY_NEWS, 'hi@news.example');
      const shopId = await seedSender(db, mailboxA.mailboxAccountId, KEY_SHOP, 'hi@shop.example');
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-25', {
        payload: noisePayload([
          { senderKey: KEY_NEWS, senderName: 'News' },
          { senderKey: KEY_SHOP, senderName: 'Shop' },
        ]),
      });

      const brief = await service.getForDate(mailboxA.mailboxAccountId, '2026-05-25');
      expect(brief!.noiseSenders).toEqual([
        { senderKey: KEY_NEWS, senderId: newsId, isProtected: false },
        { senderKey: KEY_SHOP, senderId: shopId, isProtected: false },
      ]);
    });

    it('reports a Protected sender so bulk actions can exclude it (D245)', async () => {
      await seedSender(db, mailboxA.mailboxAccountId, KEY_NEWS, 'hi@news.example');
      await protectSender(db, mailboxA.mailboxAccountId, KEY_NEWS);
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-25', {
        payload: noisePayload([{ senderKey: KEY_NEWS, senderName: 'News' }]),
      });

      const brief = await service.getForDate(mailboxA.mailboxAccountId, '2026-05-25');
      expect(brief!.noiseSenders[0]!.isProtected).toBe(true);
    });

    it('does not treat a merely unprotected policy row as protected', async () => {
      // The memory-pin state (migration 0023): `is_protected = false`
      // with a reason still recorded. That is NOT protection.
      await seedSender(db, mailboxA.mailboxAccountId, KEY_NEWS, 'hi@news.example');
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxA.mailboxAccountId,
        senderKey: KEY_NEWS,
        isProtected: false,
        protectionReason: 'replied',
      });
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-25', {
        payload: noisePayload([{ senderKey: KEY_NEWS, senderName: 'News' }]),
      });

      const brief = await service.getForDate(mailboxA.mailboxAccountId, '2026-05-25');
      expect(brief!.noiseSenders[0]!.isProtected).toBe(false);
    });

    it('returns a null id for a sender that no longer exists', async () => {
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-25', {
        payload: noisePayload([{ senderKey: KEY_GONE, senderName: 'Deleted Co' }]),
      });

      const brief = await service.getForDate(mailboxA.mailboxAccountId, '2026-05-25');
      expect(brief!.noiseSenders).toEqual([
        { senderKey: KEY_GONE, senderId: null, isProtected: false },
      ]);
      // The frozen group survives — the snapshot is not rewritten.
      expect(brief!.briefPayload.noise).toHaveLength(1);
    });

    it('never resolves a sender id from another mailbox', async () => {
      // Same sender_key in mailbox B. Resolving it would point mailbox
      // A's archive at a row it does not own.
      await seedSender(db, mailboxB.mailboxAccountId, KEY_NEWS, 'hi@news.example');
      await protectSender(db, mailboxB.mailboxAccountId, KEY_NEWS);
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-25', {
        payload: noisePayload([{ senderKey: KEY_NEWS, senderName: 'News' }]),
      });

      const brief = await service.getForDate(mailboxA.mailboxAccountId, '2026-05-25');
      expect(brief!.noiseSenders).toEqual([
        { senderKey: KEY_NEWS, senderId: null, isProtected: false },
      ]);
    });

    it('leaves the array empty when the Brief has no Noise section', async () => {
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-25');
      const brief = await service.getForDate(mailboxA.mailboxAccountId, '2026-05-25');
      expect(brief!.noiseSenders).toEqual([]);
    });

    it('resolves per-brief across a listed range', async () => {
      const newsId = await seedSender(db, mailboxA.mailboxAccountId, KEY_NEWS, 'hi@news.example');
      const shopId = await seedSender(db, mailboxA.mailboxAccountId, KEY_SHOP, 'hi@shop.example');
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-24', {
        payload: noisePayload([{ senderKey: KEY_NEWS, senderName: 'News' }]),
      });
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-25', {
        payload: noisePayload([{ senderKey: KEY_SHOP, senderName: 'Shop' }]),
      });

      const briefs = await service.listByRange(
        mailboxA.mailboxAccountId,
        '2026-05-01',
        '2026-05-31',
      );
      // Newest first — each Brief gets its OWN senders, not the page's.
      expect(briefs[0]!.noiseSenders).toEqual([
        { senderKey: KEY_SHOP, senderId: shopId, isProtected: false },
      ]);
      expect(briefs[1]!.noiseSenders).toEqual([
        { senderKey: KEY_NEWS, senderId: newsId, isProtected: false },
      ]);
    });
  });
});
