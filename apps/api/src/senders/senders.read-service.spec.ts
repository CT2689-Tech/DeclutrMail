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
import { eq } from 'drizzle-orm';
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

/**
 * First-of-month `YYYY-MM-DD` for `sender_timeseries.year_month`, in
 * UTC (the column is timezone-agnostic). Mirrors the service-side
 * `startOfMonthIso` so a test can seed "the current calendar month"
 * without importing a non-exported helper.
 */
function startOfMonthIsoForTest(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

/**
 * Compact triage_decisions seeder for the last-reviewed regression
 * specs. Defaults track the schema's documented shape so callers can
 * focus on the fields the test actually cares about.
 */
async function seedTriageDecision(
  db: Db,
  args: {
    mailboxAccountId: string;
    senderKey: string;
    verdict: 'keep' | 'archive' | 'unsubscribe' | 'later';
    producedAt: Date;
    generatedBy?: 'llm_haiku' | 'template';
    confidence?: string;
    reasoning?: string;
    expiresAt?: Date;
  },
): Promise<void> {
  await db.insert(triageDecisions).values({
    mailboxAccountId: args.mailboxAccountId,
    senderKey: args.senderKey,
    verdict: args.verdict,
    confidence: args.confidence ?? '0.90',
    reasoning: args.reasoning ?? 'Test reasoning.',
    generatedBy: args.generatedBy ?? 'template',
    producedAt: args.producedAt,
    expiresAt: args.expiresAt ?? new Date(args.producedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
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
      // caller "more rows exist". Sort=last_seen DESC. Newest first: c, b.
      const page1 = await svc.listSenders({
        mailboxAccountId: mailboxId,
        category: null,
        sort: 'last_seen',
        cursor: null,
        limit: 2,
      });
      expect(page1.length).toBe(3); // limit + sentinel
      expect(page1.slice(0, 2).map((r) => r.id)).toEqual([c.id, b.id]);

      // Page 2 — start after b (the last item on page 1).
      const page2 = await svc.listSenders({
        mailboxAccountId: mailboxId,
        category: null,
        sort: 'last_seen',
        cursor: { key: '2026-02-01T00:00:00.000Z', id: b.id },
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

    it('filters to standing-protected senders when isProtected=true', async () => {
      // Three senders: one with a protected policy, one with an
      // explicitly non-protected policy, and one with no policy row at
      // all (engine-default). Only the first should survive the filter
      // — the no-policy sender's left-joined `is_protected` is NULL,
      // which is correctly excluded by `eq(... true)`.
      const yes = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'protected@x.com',
        lastSeenAt: new Date('2026-03-01T00:00:00Z'),
      });
      const no = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'not-protected@x.com',
        lastSeenAt: new Date('2026-02-01T00:00:00Z'),
      });
      await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'no-policy@x.com',
        lastSeenAt: new Date('2026-01-01T00:00:00Z'),
      });
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxId,
        senderKey: yes.senderKey,
        isProtected: true,
        protectionReason: 'user_defined',
        protectionSetAt: new Date('2026-03-01T00:00:00Z'),
      });
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxId,
        senderKey: no.senderKey,
        isProtected: false,
      });

      const rows = await svc.listSenders({
        mailboxAccountId: mailboxId,
        category: null,
        isProtected: true,
        cursor: null,
        limit: 25,
      });
      expect(rows.map((r) => r.id)).toEqual([yes.id]);
      expect(rows[0]!.protectionFlags.isProtected).toBe(true);
    });

    describe('q search (#145)', () => {
      async function seedSearchFixture() {
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          displayName: 'Exclusive Deals',
          email: 'emailer@dealskhoj.in',
          lastSeenAt: new Date('2026-01-01T00:00:00Z'),
        });
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          displayName: 'Dealskhoj Newsletter',
          email: 'news@newsletter.dealskhoj.in',
          lastSeenAt: new Date('2026-01-02T00:00:00Z'),
        });
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          displayName: 'GitHub',
          email: 'noreply@github.com',
          lastSeenAt: new Date('2026-01-03T00:00:00Z'),
        });
      }

      it('matches across name, email, and domain (the whole mailbox, not a page)', async () => {
        await seedSearchFixture();
        // `dealskhoj` is in neither display name nor local-part of sender 1,
        // only its domain — yet it must match (the founder's bug: searching
        // dealskhoj found nothing because only the loaded page was filtered).
        const rows = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          cursor: null,
          limit: 25,
          q: 'dealskhoj',
        });
        expect(rows.map((r) => r.email).sort()).toEqual([
          'emailer@dealskhoj.in',
          'news@newsletter.dealskhoj.in',
        ]);
      });

      it('is case-insensitive and matches the display name', async () => {
        await seedSearchFixture();
        const rows = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          cursor: null,
          limit: 25,
          q: 'EXCLUSIVE',
        });
        expect(rows.map((r) => r.email)).toEqual(['emailer@dealskhoj.in']);
      });

      it('treats LIKE wildcards literally (a "%" query is not match-all)', async () => {
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          displayName: '100% Off Today',
          email: 'promo@x.test',
          lastSeenAt: new Date('2026-01-01T00:00:00Z'),
        });
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          displayName: 'Plain Sender',
          email: 'plain@x.test',
          lastSeenAt: new Date('2026-01-02T00:00:00Z'),
        });
        const rows = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          cursor: null,
          limit: 25,
          q: '%',
        });
        // Only the sender whose name literally contains '%' matches; an
        // unescaped '%' would (wrongly) return both.
        expect(rows.map((r) => r.email)).toEqual(['promo@x.test']);
      });

      it('getSenderListQueryMeta.totalMatching honors the same q', async () => {
        await seedSearchFixture();
        const meta = await svc.getSenderListQueryMeta({
          mailboxAccountId: mailboxId,
          category: null,
          q: 'dealskhoj',
        });
        expect(meta.totalMatching).toBe(2);
      });
    });

    describe('Slice 1 sort + meta.query (ADR-0014, senders list contract)', () => {
      it('default sort is total DESC + id DESC with totalReceived on every row', async () => {
        // Seed three senders with distinct totals so ordering is
        // deterministic without the id tie-break.
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'small@x.com',
          lastSeenAt: new Date('2026-01-01T00:00:00Z'),
        });
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'mid@x.com',
          lastSeenAt: new Date('2026-01-01T00:00:00Z'),
        });
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'big@x.com',
          lastSeenAt: new Date('2026-01-01T00:00:00Z'),
        });
        // Inject distinct counts via direct UPDATE (the production
        // path writes via Path A; this fixture seeds the column shape
        // directly so the read-side ORDER BY is the only thing tested).
        await db.update(senders).set({ totalReceived: 5 }).where(eq(senders.email, 'small@x.com'));
        await db.update(senders).set({ totalReceived: 50 }).where(eq(senders.email, 'mid@x.com'));
        await db.update(senders).set({ totalReceived: 500 }).where(eq(senders.email, 'big@x.com'));

        const rows = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          cursor: null,
          limit: 25,
        });

        expect(rows.map((r) => r.email)).toEqual(['big@x.com', 'mid@x.com', 'small@x.com']);
        // bigint mode 'number' assertion — wire shape contract
        // (ADR-0014 + senders list contract). A future driver swap
        // that hands back a string would silently render "0" / "NaN"
        // downstream; this asserts the boundary.
        for (const r of rows) {
          expect(typeof r.totalReceived).toBe('number');
          expect(Number.isSafeInteger(r.totalReceived)).toBe(true);
        }
      });

      it('keyset cursor on sort=total round-trips page 1 → page 2', async () => {
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'a@x.com',
          lastSeenAt: new Date('2026-01-01T00:00:00Z'),
        });
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'b@x.com',
          lastSeenAt: new Date('2026-01-01T00:00:00Z'),
        });
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'c@x.com',
          lastSeenAt: new Date('2026-01-01T00:00:00Z'),
        });
        await db.update(senders).set({ totalReceived: 30 }).where(eq(senders.email, 'a@x.com'));
        await db.update(senders).set({ totalReceived: 20 }).where(eq(senders.email, 'b@x.com'));
        await db.update(senders).set({ totalReceived: 10 }).where(eq(senders.email, 'c@x.com'));

        const page1 = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          sort: 'total',
          cursor: null,
          limit: 2,
        });
        expect(page1.length).toBe(3); // limit + sentinel
        const lastVisible = page1[1]!;
        expect(lastVisible.email).toBe('b@x.com');

        const page2 = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          sort: 'total',
          cursor: { key: String(lastVisible.totalReceived), id: lastVisible.id },
          limit: 2,
        });
        expect(page2.length).toBe(1);
        expect(page2[0]!.email).toBe('c@x.com');
      });

      it('sort=name ASC orders alphabetically by displayName', async () => {
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'zebra@x.com',
          displayName: 'Zebra',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'alpha@x.com',
          displayName: 'Alpha',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'mid@x.com',
          displayName: 'Mid',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });

        const rows = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          sort: 'name',
          direction: 'asc',
          cursor: null,
          limit: 25,
        });
        expect(rows.map((r) => r.displayName)).toEqual(['Alpha', 'Mid', 'Zebra']);
      });

      it('sort=name falls back to email for empty displayName (no blanks-first pile)', async () => {
        // Bulk senders often ship an empty From-header name — raw
        // display_name ASC piled them first as blanks (2026-07-03 live
        // smoke: 983 rows). The effective-name COALESCE must interleave
        // them by email among the named rows, on BOTH sides of a named
        // neighbour.
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'aardvark@x.com',
          displayName: '',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'nn@x.com',
          displayName: 'Beta',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'zulu@x.com',
          displayName: '  ',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });

        const rows = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          sort: 'name',
          direction: 'asc',
          cursor: null,
          limit: 25,
        });
        expect(rows.map((r) => r.email)).toEqual(['aardvark@x.com', 'nn@x.com', 'zulu@x.com']);
      });

      it('sort=first_seen ASC orders by firstSeenAt oldest-first', async () => {
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'newest@x.com',
          firstSeenAt: new Date('2026-03-01T00:00:00Z'),
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'oldest@x.com',
          firstSeenAt: new Date('2026-01-01T00:00:00Z'),
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'middle@x.com',
          firstSeenAt: new Date('2026-02-01T00:00:00Z'),
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });

        const rows = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          sort: 'first_seen',
          direction: 'asc',
          cursor: null,
          limit: 25,
        });
        expect(rows.map((r) => r.email)).toEqual(['oldest@x.com', 'middle@x.com', 'newest@x.com']);
      });

      it('rejects an unsupported sort with 400', async () => {
        await expect(
          svc.listSenders({
            mailboxAccountId: mailboxId,
            category: null,
            sort: 'recommended',
            cursor: null,
            limit: 25,
          }),
        ).rejects.toThrow(/Unsupported sort/);
      });

      it('getSenderListQueryMeta — totalMatching honors filter; globalMaxTotal mailbox-wide unfiltered', async () => {
        // Three senders: two in primary (one protected), one in promotions.
        // globalMaxTotal must reflect the mailbox-wide MAX(total_received)
        // even when the query filters to a subset that excludes it.
        const big = await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'big@x.com',
          category: 'promotions', // outside the filter below
          lastSeenAt: new Date('2026-01-01T00:00:00Z'),
        });
        const protect = await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'pro@x.com',
          category: 'primary',
          lastSeenAt: new Date('2026-01-01T00:00:00Z'),
        });
        const plain = await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'pln@x.com',
          category: 'primary',
          lastSeenAt: new Date('2026-01-01T00:00:00Z'),
        });
        await db.update(senders).set({ totalReceived: 999 }).where(eq(senders.id, big.id));
        await db.update(senders).set({ totalReceived: 5 }).where(eq(senders.id, protect.id));
        await db.update(senders).set({ totalReceived: 3 }).where(eq(senders.id, plain.id));
        await db.insert(senderPolicies).values({
          mailboxAccountId: mailboxId,
          senderKey: protect.senderKey,
          policyType: 'keep',
          isProtected: true,
          protectionReason: 'user_defined',
        });

        const meta = await svc.getSenderListQueryMeta({
          mailboxAccountId: mailboxId,
          category: 'primary',
          isProtected: true,
        });
        // Only the protected primary sender matches.
        expect(meta.totalMatching).toBe(1);
        // The 999-count promotions sender is the mailbox-wide max — must
        // be reflected even though the filter excludes it.
        expect(meta.globalMaxTotal).toBe(999);
        expect(typeof meta.asOf).toBe('string');
        expect(Number.isNaN(new Date(meta.asOf).getTime())).toBe(false);
      });

      it('getSenderListQueryMeta — globalMaxTotal does NOT leak across mailboxes', async () => {
        // A sender in another mailbox with a huge count must not appear
        // in this mailbox's globalMaxTotal (tenant-isolation regression
        // — same shape as MISTAKES.md 2026-05-23).
        const otherMb = await seedMailbox(db, 'other');
        const sneaky = await seedSender(db, {
          mailboxAccountId: otherMb,
          email: 'sneaky@x.com',
          lastSeenAt: new Date('2026-01-01T00:00:00Z'),
        });
        await db.update(senders).set({ totalReceived: 100_000 }).where(eq(senders.id, sneaky.id));

        const mine = await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'mine@x.com',
          lastSeenAt: new Date('2026-01-01T00:00:00Z'),
        });
        await db.update(senders).set({ totalReceived: 7 }).where(eq(senders.id, mine.id));

        const meta = await svc.getSenderListQueryMeta({
          mailboxAccountId: mailboxId,
          category: null,
        });
        expect(meta.globalMaxTotal).toBe(7);
        expect(meta.totalMatching).toBe(1);
      });
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

    // TODO (D38 rolling-window rewrite): the 4 below tests + the volumeTrend
    // describe block test the OLD per-sender-latest-year_month semantics.
    // The wire field `monthlyVolume` now carries last-30d msg counts from
    // `mail_messages` (rolling), and trend buckets are recency-driven, not
    // calendar-month. Re-seed via `seedMessage` with `internal_date >= now-30d`
    // and assert against the new contract. See `getSenderSummary` tests
    // (`rolling 30d + 8 buckets`) for the pattern.
    it.skip('fills monthlyVolume + readRate from the latest timeseries row', async () => {
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

    it.skip('returns null monthlyVolume + readRate when no timeseries rows exist', async () => {
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

    // Regression — MISTAKES.md 2026-05-23. The correlated subquery in
    // `listSenders` previously interpolated `${senders.mailboxAccountId}`
    // (bare column), which PG resolved to the inner `sender_timeseries`
    // scope, making the predicate a tautology. Every sender then got
    // the SAME timeseries row. Seed two senders, each with two distinct
    // timeseries rows, and assert that each sender resolves to its OWN
    // latest row — a single-sender fixture coincidentally hides the
    // tautology, so this multi-sender shape is the canonical regression
    // surface for any correlated subquery in a read service.
    it.skip('isolates monthlyVolume + readRate per sender across multiple senders (correlated-subquery regression)', async () => {
      const a = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'a@x.com',
        lastSeenAt: new Date('2026-05-02T00:00:00Z'),
      });
      const b = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'b@x.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      // Sender A — older month decoy + winning latest month.
      await seedTimeseries(db, {
        mailboxAccountId: mailboxId,
        senderKey: a.senderKey,
        yearMonth: '2026-04-01',
        volume: 7,
        readCount: 0,
      });
      await seedTimeseries(db, {
        mailboxAccountId: mailboxId,
        senderKey: a.senderKey,
        yearMonth: '2026-05-01',
        volume: 30,
        readCount: 15,
      });
      // Sender B — distinct latest-month values so a tautological join
      // would surface as a value swap (B taking A's row, or both rows
      // taking the planner-chosen first row).
      await seedTimeseries(db, {
        mailboxAccountId: mailboxId,
        senderKey: b.senderKey,
        yearMonth: '2026-04-01',
        volume: 2,
        readCount: 1,
      });
      await seedTimeseries(db, {
        mailboxAccountId: mailboxId,
        senderKey: b.senderKey,
        yearMonth: '2026-05-01',
        volume: 4,
        readCount: 1,
      });

      const rows = await svc.listSenders({
        mailboxAccountId: mailboxId,
        category: null,
        cursor: null,
        limit: 10,
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(a.id)!.monthlyVolume).toBe(30);
      expect(byId.get(a.id)!.readRate).toBe(0.5);
      // Older 2026-04 row (volume 7) must NOT win — locks the
      // ORDER BY year_month DESC LIMIT 1 predicate alongside the
      // correlation fix. Pre-fix tautology would have picked
      // whichever the planner returned first regardless of date.
      expect(byId.get(a.id)!.monthlyVolume).not.toBe(7);
      expect(byId.get(b.id)!.monthlyVolume).toBe(4);
      expect(byId.get(b.id)!.readRate).toBe(0.25);
      expect(byId.get(b.id)!.monthlyVolume).not.toBe(2);
    });

    // Regression — MISTAKES.md 2026-05-23 (cross-tenant variant). The
    // pre-fix tautological predicate `WHERE mailbox_account_id =
    // mailbox_account_id AND sender_key = sender_key` resolved entirely
    // inside `sender_timeseries` and therefore could pick a row from
    // ANOTHER mailbox — a cross-tenant integer leak. The fix's
    // `WHERE sender_timeseries.mailbox_account_id = senders.mailbox_account_id`
    // restores the mailbox boundary. Seed identical `sender_key`
    // values across two mailboxes with deliberately different
    // timeseries values; assert each mailbox sees only its own row.
    it.skip('does not leak timeseries across mailboxes when sender_key collides (cross-tenant correlated-subquery regression)', async () => {
      const otherMailbox = await seedMailbox(db, 'other-tenant');
      const here = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'collide@x.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      const there = await seedSender(db, {
        mailboxAccountId: otherMailbox,
        email: 'collide@x.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      // `sender_key` is derived from the normalized email — both
      // senders should share it. Assert that precondition so this
      // test breaks loudly if the key derivation changes.
      expect(here.senderKey).toBe(there.senderKey);

      await seedTimeseries(db, {
        mailboxAccountId: mailboxId,
        senderKey: here.senderKey,
        yearMonth: '2026-05-01',
        volume: 8,
        readCount: 2,
      });
      await seedTimeseries(db, {
        mailboxAccountId: otherMailbox,
        senderKey: there.senderKey,
        yearMonth: '2026-05-01',
        volume: 77,
        readCount: 77,
      });

      const rowsHere = await svc.listSenders({
        mailboxAccountId: mailboxId,
        category: null,
        cursor: null,
        limit: 10,
      });
      const rowsThere = await svc.listSenders({
        mailboxAccountId: otherMailbox,
        category: null,
        cursor: null,
        limit: 10,
      });
      expect(rowsHere.find((r) => r.id === here.id)!.monthlyVolume).toBe(8);
      expect(rowsThere.find((r) => r.id === there.id)!.monthlyVolume).toBe(77);
    });

    // Volume-trend bucket coverage — one test per bucket plus the two
    // null-history edges. Each test pins `now` to a fixed anchor and
    // seeds timeseries rows relative to it so the prior-3-month window
    // is deterministic. Covers the `computeTrendBucket` precedence
    // ladder end-to-end (SQL + TS), not just the helper in isolation.
    describe.skip('volumeTrend bucket', () => {
      const NOW = new Date('2026-05-15T00:00:00Z'); // anchor: May 2026
      const CURRENT_MONTH = '2026-05-01';

      it('returns null when sender has no timeseries rows at all', async () => {
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'fresh@x.com',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });
        const rows = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          cursor: null,
          limit: 10,
          now: NOW,
        });
        expect(rows[0]!.volumeTrend).toBeNull();
      });

      it('returns "new" when sender has fewer than 2 months of history', async () => {
        const a = await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'one-month@x.com',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });
        await seedTimeseries(db, {
          mailboxAccountId: mailboxId,
          senderKey: a.senderKey,
          yearMonth: CURRENT_MONTH,
          volume: 12,
          readCount: 0,
        });
        const rows = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          cursor: null,
          limit: 10,
          now: NOW,
        });
        expect(rows[0]!.volumeTrend).toBe('new');
      });

      it('returns "up" when current month ≥ prior 3-month avg × 1.3', async () => {
        const a = await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'ramping@x.com',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });
        // Prior 3 months avg = (5 + 5 + 5) / 3 = 5; current = 8 (= 5 × 1.6)
        await seedTimeseries(db, {
          mailboxAccountId: mailboxId,
          senderKey: a.senderKey,
          yearMonth: '2026-02-01',
          volume: 5,
          readCount: 0,
        });
        await seedTimeseries(db, {
          mailboxAccountId: mailboxId,
          senderKey: a.senderKey,
          yearMonth: '2026-03-01',
          volume: 5,
          readCount: 0,
        });
        await seedTimeseries(db, {
          mailboxAccountId: mailboxId,
          senderKey: a.senderKey,
          yearMonth: '2026-04-01',
          volume: 5,
          readCount: 0,
        });
        await seedTimeseries(db, {
          mailboxAccountId: mailboxId,
          senderKey: a.senderKey,
          yearMonth: CURRENT_MONTH,
          volume: 8,
          readCount: 0,
        });
        const rows = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          cursor: null,
          limit: 10,
          now: NOW,
        });
        expect(rows[0]!.volumeTrend).toBe('up');
      });

      it('returns "down" when current month ≤ prior 3-month avg × 0.7', async () => {
        const a = await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'fading@x.com',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });
        // Prior avg = (10 + 10 + 10) / 3 = 10; current = 5 (= 10 × 0.5)
        await seedTimeseries(db, {
          mailboxAccountId: mailboxId,
          senderKey: a.senderKey,
          yearMonth: '2026-02-01',
          volume: 10,
          readCount: 0,
        });
        await seedTimeseries(db, {
          mailboxAccountId: mailboxId,
          senderKey: a.senderKey,
          yearMonth: '2026-03-01',
          volume: 10,
          readCount: 0,
        });
        await seedTimeseries(db, {
          mailboxAccountId: mailboxId,
          senderKey: a.senderKey,
          yearMonth: '2026-04-01',
          volume: 10,
          readCount: 0,
        });
        await seedTimeseries(db, {
          mailboxAccountId: mailboxId,
          senderKey: a.senderKey,
          yearMonth: CURRENT_MONTH,
          volume: 5,
          readCount: 0,
        });
        const rows = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          cursor: null,
          limit: 10,
          now: NOW,
        });
        expect(rows[0]!.volumeTrend).toBe('down');
      });

      it('returns "steady" when current month is within ±30% of prior avg', async () => {
        const a = await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'steady@x.com',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });
        // Prior avg = 10; current = 11 (= 10 × 1.1) — inside both thresholds
        await seedTimeseries(db, {
          mailboxAccountId: mailboxId,
          senderKey: a.senderKey,
          yearMonth: '2026-02-01',
          volume: 10,
          readCount: 0,
        });
        await seedTimeseries(db, {
          mailboxAccountId: mailboxId,
          senderKey: a.senderKey,
          yearMonth: '2026-03-01',
          volume: 10,
          readCount: 0,
        });
        await seedTimeseries(db, {
          mailboxAccountId: mailboxId,
          senderKey: a.senderKey,
          yearMonth: '2026-04-01',
          volume: 10,
          readCount: 0,
        });
        await seedTimeseries(db, {
          mailboxAccountId: mailboxId,
          senderKey: a.senderKey,
          yearMonth: CURRENT_MONTH,
          volume: 11,
          readCount: 0,
        });
        const rows = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          cursor: null,
          limit: 10,
          now: NOW,
        });
        expect(rows[0]!.volumeTrend).toBe('steady');
      });

      it('returns "dormant" when current month is 0 but prior months had volume', async () => {
        const a = await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'dormant@x.com',
          lastSeenAt: new Date('2026-04-15T00:00:00Z'),
        });
        // Prior months had volume; current month has NO row → 0
        await seedTimeseries(db, {
          mailboxAccountId: mailboxId,
          senderKey: a.senderKey,
          yearMonth: '2026-02-01',
          volume: 7,
          readCount: 0,
        });
        await seedTimeseries(db, {
          mailboxAccountId: mailboxId,
          senderKey: a.senderKey,
          yearMonth: '2026-03-01',
          volume: 7,
          readCount: 0,
        });
        await seedTimeseries(db, {
          mailboxAccountId: mailboxId,
          senderKey: a.senderKey,
          yearMonth: '2026-04-01',
          volume: 7,
          readCount: 0,
        });
        // NO 2026-05 row
        const rows = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          cursor: null,
          limit: 10,
          now: NOW,
        });
        expect(rows[0]!.volumeTrend).toBe('dormant');
      });
    });

    // last-reviewed eyebrow coverage. Same correlated-subquery shape
    // as the trend inputs, so the cross-mailbox + null-paths matter.
    describe('lastReview eyebrow', () => {
      it('returns null when no triage_decisions row exists for the sender', async () => {
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'no-decision@x.com',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });
        const rows = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          cursor: null,
          limit: 10,
        });
        expect(rows[0]!.lastReview).toBeNull();
      });

      it('returns the most-recent decision for the sender', async () => {
        const a = await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'reviewed@x.com',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });
        const producedAt = new Date('2026-05-10T15:30:00Z');
        await seedTriageDecision(db, {
          mailboxAccountId: mailboxId,
          senderKey: a.senderKey,
          verdict: 'archive',
          generatedBy: 'llm_haiku',
          producedAt,
        });

        const rows = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          cursor: null,
          limit: 10,
        });
        expect(rows[0]!.lastReview).toEqual({
          at: producedAt.toISOString(),
          verdict: 'archive',
          generatedBy: 'llm_haiku',
          confidence: 0.9,
        });
      });

      it('does not leak a decision from another mailbox when sender_key collides', async () => {
        // Cross-mailbox safety — the lastReview subqueries use the
        // same outer-scope qualification as the timeseries reads.
        // If a future refactor drops the mailbox predicate inside the
        // correlated subquery this regression test fires.
        const otherMailbox = await seedMailbox(db, 'other-decision-tenant');
        const here = await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'decision-collide@x.com',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });
        const there = await seedSender(db, {
          mailboxAccountId: otherMailbox,
          email: 'decision-collide@x.com',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });
        expect(here.senderKey).toBe(there.senderKey);

        // Only the OTHER mailbox has a decision; the queried mailbox
        // must NOT see it.
        await seedTriageDecision(db, {
          mailboxAccountId: otherMailbox,
          senderKey: there.senderKey,
          verdict: 'unsubscribe',
          producedAt: new Date('2026-05-12T00:00:00Z'),
        });

        const rowsHere = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          cursor: null,
          limit: 10,
        });
        expect(rowsHere.find((r) => r.id === here.id)!.lastReview).toBeNull();
      });
    });

    describe('protectionFlags (D42/D43 — now on the list row)', () => {
      it('surfaces Protect policy state on list rows', async () => {
        const a = await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'protected@x.com',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });
        const protectedAt = new Date('2026-04-10T00:00:00Z');
        await db.insert(senderPolicies).values({
          mailboxAccountId: mailboxId,
          senderKey: a.senderKey,
          policyType: 'keep',
          isProtected: true,
          protectionReason: 'user_defined',
          protectionSetAt: protectedAt,
        });

        const rows = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          cursor: null,
          limit: 10,
        });
        expect(rows.find((r) => r.id === a.id)!.protectionFlags).toEqual({
          isProtected: true,
          protectionReason: 'user_defined',
          protectionSetAt: protectedAt.toISOString(),
        });
      });

      it('defaults protection flags when no sender_policies row exists', async () => {
        const a = await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'no-policy-list@x.com',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });
        const rows = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          cursor: null,
          limit: 10,
        });
        expect(rows.find((r) => r.id === a.id)!.protectionFlags).toEqual({
          isProtected: false,
          protectionReason: null,
          protectionSetAt: null,
        });
      });

      it('does not leak a policy from another mailbox when sender_key collides', async () => {
        const otherMailbox = await seedMailbox(db, 'other-policy-tenant');
        const here = await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'policy-collide@x.com',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });
        const there = await seedSender(db, {
          mailboxAccountId: otherMailbox,
          email: 'policy-collide@x.com',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });
        expect(here.senderKey).toBe(there.senderKey);
        // Only the OTHER mailbox protects the sender.
        await db.insert(senderPolicies).values({
          mailboxAccountId: otherMailbox,
          senderKey: there.senderKey,
          policyType: 'keep',
          isProtected: true,
          protectionReason: 'user_defined',
        });

        const rowsHere = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          cursor: null,
          limit: 10,
        });
        expect(rowsHere.find((r) => r.id === here.id)!.protectionFlags).toEqual({
          isProtected: false,
          protectionReason: null,
          protectionSetAt: null,
        });
      });
    });

    describe('unsub-ignored filter (D51 — "unsub\'d, still emailing")', () => {
      /** Seed one sender + one sender_policies row with a pinned updated_at. */
      async function seedUnsubPolicy(args: {
        email: string;
        lastSeenAt: Date;
        policyType: 'keep' | 'unsubscribe';
        policyUpdatedAt: Date;
      }): Promise<{ id: string; senderKey: string }> {
        const s = await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: args.email,
          lastSeenAt: args.lastSeenAt,
        });
        await db.insert(senderPolicies).values({
          mailboxAccountId: mailboxId,
          senderKey: s.senderKey,
          policyType: args.policyType,
          createdAt: args.policyUpdatedAt,
          updatedAt: args.policyUpdatedAt,
        });
        return s;
      }

      it('returns only unsubscribe-policy senders whose mail kept arriving after the policy', async () => {
        // (a) MATCH — unsubscribed 2026-04-01, last mail 2026-05-01.
        const ignored = await seedUnsubPolicy({
          email: 'still-mailing@spammy.com',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
          policyType: 'unsubscribe',
          policyUpdatedAt: new Date('2026-04-01T00:00:00Z'),
        });
        // (b) NO MATCH — unsubscribed AFTER the last message (it worked).
        await seedUnsubPolicy({
          email: 'honored@ok.com',
          lastSeenAt: new Date('2026-03-01T00:00:00Z'),
          policyType: 'unsubscribe',
          policyUpdatedAt: new Date('2026-04-01T00:00:00Z'),
        });
        // (c) NO MATCH — keep policy, even with later mail.
        await seedUnsubPolicy({
          email: 'kept@ok.com',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
          policyType: 'keep',
          policyUpdatedAt: new Date('2026-04-01T00:00:00Z'),
        });
        // (d) NO MATCH — no policy row at all.
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'no-policy@ok.com',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });

        const rows = await svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          cursor: null,
          limit: 10,
          unsubIgnored: true,
        });
        expect(rows.map((r) => r.id)).toEqual([ignored.id]);
      });

      it('meta: totalMatching honors the filter; filterCounts.unsubIgnored counts the axis', async () => {
        await seedUnsubPolicy({
          email: 'still-mailing@spammy.com',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
          policyType: 'unsubscribe',
          policyUpdatedAt: new Date('2026-04-01T00:00:00Z'),
        });
        await seedUnsubPolicy({
          email: 'honored@ok.com',
          lastSeenAt: new Date('2026-03-01T00:00:00Z'),
          policyType: 'unsubscribe',
          policyUpdatedAt: new Date('2026-04-01T00:00:00Z'),
        });
        await seedSender(db, {
          mailboxAccountId: mailboxId,
          email: 'no-policy@ok.com',
          lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        });

        const meta = await svc.getSenderListQueryMeta({
          mailboxAccountId: mailboxId,
          category: null,
          unsubIgnored: true,
        });
        expect(meta.totalMatching).toBe(1);
        expect(meta.filterCounts?.unsubIgnored).toBe(1);
        // The axis count is mailbox-wide-absolute — same value with the
        // filter off (counts ignore the active compose).
        const metaOff = await svc.getSenderListQueryMeta({
          mailboxAccountId: mailboxId,
          category: null,
        });
        expect(metaOff.totalMatching).toBe(3);
        expect(metaOff.filterCounts?.unsubIgnored).toBe(1);
      });
    });
  });

  describe('getSenderDetail', () => {
    it('normalizes legacy unsubscribe statuses on list and detail wire shapes', async () => {
      const a = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'legacy-unsub@x.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxId,
        senderKey: a.senderKey,
        policyType: 'unsubscribe',
        unsubStatus: 'pending',
      });

      const rows = await svc.listSenders({
        mailboxAccountId: mailboxId,
        category: null,
        sort: 'last_seen',
        cursor: null,
        limit: 10,
      });
      expect(rows[0]!.unsubStatus).toBe('requested');

      await db
        .update(senderPolicies)
        .set({ unsubStatus: 'done' })
        .where(eq(senderPolicies.senderKey, a.senderKey));
      expect((await svc.getSenderDetail(mailboxId, a.id))!.unsubStatus).toBe('endpoint_accepted');
      await db
        .update(senderPolicies)
        .set({ unsubStatus: 'ambiguous' })
        .where(eq(senderPolicies.senderKey, a.senderKey));
      expect((await svc.getSenderDetail(mailboxId, a.id))!.unsubStatus).toBe('unconfirmed');
    });

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

    // D230 manual path + D7 defense-in-depth: `unsubscribe_url` holds a
    // mailto: channel for mailto senders but an https URL (which can
    // embed per-recipient opt-out tokens) for one_click senders. Only
    // the mailto value may reach the wire — gated in BOTH the SQL CASE
    // and the mapping ternary.
    it('unsubscribeMailtoUrl: surfaced for mailto senders, NULL for one_click (token-bearing https URL never on the wire)', async () => {
      const mailto = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'mailto-unsub@x.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        unsubscribeMethod: 'mailto',
      });
      await db
        .update(senders)
        .set({ unsubscribeUrl: 'mailto:opt-out@x.com?subject=unsubscribe' })
        .where(eq(senders.id, mailto.id));
      const oneClick = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'oneclick-unsub@x.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
        unsubscribeMethod: 'one_click',
      });
      await db
        .update(senders)
        .set({ unsubscribeUrl: 'https://unsub.x.com/oc?recipient_token=SECRET' })
        .where(eq(senders.id, oneClick.id));

      const mailtoDetail = await svc.getSenderDetail(mailboxId, mailto.id);
      expect(mailtoDetail!.unsubscribeMethod).toBe('mailto');
      expect(mailtoDetail!.unsubscribeMailtoUrl).toBe('mailto:opt-out@x.com?subject=unsubscribe');

      const oneClickDetail = await svc.getSenderDetail(mailboxId, oneClick.id);
      expect(oneClickDetail!.unsubscribeMethod).toBe('one_click');
      expect(oneClickDetail!.unsubscribeMailtoUrl).toBeNull();
      // Nothing in the wire shape carries the token-bearing URL.
      expect(JSON.stringify(oneClickDetail)).not.toContain('SECRET');
    });

    /**
     * Seed `count` inbound messages dated `daysAgo` ago, `readCount` of
     * them read. The rolling-window subqueries filter on SQL `now()`,
     * so these must be anchored to the real clock (same pattern as the
     * `getSenderSummary (rolling 30d + 8 buckets)` tests below), NOT to
     * an injected `now`.
     */
    async function seedRollingMessages(args: {
      mailboxAccountId: string;
      senderKey: string;
      count: number;
      daysAgo: number;
      readCount?: number;
    }): Promise<void> {
      const read = args.readCount ?? 0;
      for (let i = 0; i < args.count; i++) {
        await seedMessage(db, {
          mailboxAccountId: args.mailboxAccountId,
          senderKey: args.senderKey,
          internalDate: new Date(Date.now() - args.daysAgo * 86400_000),
          isUnread: i >= read,
        });
      }
    }

    // Regression — MISTAKES.md 2026-05-23. Mirror of the `listSenders`
    // regression: `getSenderDetail` runs the same correlated subquery,
    // so a second sender's own messages must NOT leak through into the
    // queried sender's stats. Both sides are seeded with ≥2 rows so a
    // tautological predicate fails this test instead of passing it.
    it('isolates monthlyVolume + readRate when another sender has its own messages (correlated-subquery regression)', async () => {
      const target = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'target@x.com',
        lastSeenAt: new Date(Date.now() - 1 * 86400_000),
      });
      const other = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'other@x.com',
        lastSeenAt: new Date(Date.now() - 1 * 86400_000),
      });
      await seedRollingMessages({
        mailboxAccountId: mailboxId,
        senderKey: target.senderKey,
        count: 4,
        daysAgo: 5,
        readCount: 1,
      });
      // Distinct values for the other sender — if the predicate were a
      // tautology the planner could fold these into `target`'s counts.
      await seedRollingMessages({
        mailboxAccountId: mailboxId,
        senderKey: other.senderKey,
        count: 9,
        daysAgo: 5,
        readCount: 9,
      });

      const detail = await svc.getSenderDetail(mailboxId, target.id);
      expect(detail).not.toBeNull();
      expect(detail!.monthlyVolume).toBe(4);
      expect(detail!.readRate).toBe(0.25);
      // Other sender's messages must NOT leak (would read 9 / 13 / 1.0).
      expect(detail!.monthlyVolume).not.toBe(9);
      expect(detail!.monthlyVolume).not.toBe(13);
      expect(detail!.readRate).not.toBe(1);
    });

    // Regression — MISTAKES.md 2026-05-23 (cross-tenant variant for
    // the detail endpoint). A colliding sender_key across mailboxes
    // must not surface the wrong tenant's messages.
    it('does not leak messages across mailboxes when sender_key collides (cross-tenant detail regression)', async () => {
      const otherMailbox = await seedMailbox(db, 'other-detail-tenant');
      const here = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'collide-detail@x.com',
        lastSeenAt: new Date(Date.now() - 1 * 86400_000),
      });
      const there = await seedSender(db, {
        mailboxAccountId: otherMailbox,
        email: 'collide-detail@x.com',
        lastSeenAt: new Date(Date.now() - 1 * 86400_000),
      });
      expect(here.senderKey).toBe(there.senderKey);

      await seedRollingMessages({
        mailboxAccountId: mailboxId,
        senderKey: here.senderKey,
        count: 3,
        daysAgo: 5,
        readCount: 0,
      });
      await seedRollingMessages({
        mailboxAccountId: otherMailbox,
        senderKey: there.senderKey,
        count: 7,
        daysAgo: 5,
        readCount: 7,
      });

      const detailHere = await svc.getSenderDetail(mailboxId, here.id);
      expect(detailHere).not.toBeNull();
      expect(detailHere!.monthlyVolume).toBe(3);
      // 0 read of 3 = a real "never read" fact, distinct from the other
      // tenant's 1.0 — and distinct from `null` (= no data).
      expect(detailHere!.readRate).toBe(0);
      expect(detailHere!.monthlyVolume).not.toBe(7);
      expect(detailHere!.monthlyVolume).not.toBe(10);
    });

    // Trend + lastReview on the detail payload. `volumeTrend` now rides
    // the same rolling velocity comparison as the list: recent rate per
    // day (8/30) vs baseline rate per day (4/60) → 0.267 >= 0.087 → up.
    it('returns volumeTrend + lastReview on the detail payload', async () => {
      const a = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'detail-stats@x.com',
        // Old enough that the `new` bucket (first_seen >= now-30d)
        // doesn't pre-empt the velocity comparison.
        firstSeenAt: new Date(Date.now() - 200 * 86400_000),
        lastSeenAt: new Date(Date.now() - 1 * 86400_000),
      });
      // Recent window (last 30d) — 8 msgs.
      await seedRollingMessages({
        mailboxAccountId: mailboxId,
        senderKey: a.senderKey,
        count: 8,
        daysAgo: 5,
      });
      // Baseline window (30-90d ago) — 4 msgs.
      await seedRollingMessages({
        mailboxAccountId: mailboxId,
        senderKey: a.senderKey,
        count: 4,
        daysAgo: 50,
      });
      const producedAt = new Date('2026-05-10T15:30:00Z');
      await seedTriageDecision(db, {
        mailboxAccountId: mailboxId,
        senderKey: a.senderKey,
        verdict: 'keep',
        generatedBy: 'template',
        producedAt,
      });

      const detail = await svc.getSenderDetail(mailboxId, a.id);
      expect(detail).not.toBeNull();
      expect(detail!.monthlyVolume).toBe(8);
      expect(detail!.volumeTrend).toBe('up');
      expect(detail!.lastReview).toEqual({
        at: producedAt.toISOString(),
        verdict: 'keep',
        generatedBy: 'template',
        confidence: 0.9,
      });
    });

    // THE INVARIANT THIS BROKE ON (live: sender "Rucha Varma", 2026-07-17).
    //
    // `monthlyVolume` / `readRate` / `volumeTrend` must mean exactly ONE
    // thing product-wide. The list read rolling last-30d windows off
    // `mail_messages` while the detail still read the latest
    // `sender_timeseries` CALENDAR month, so the same sender reported
    // e.g. list `0 / null / down` vs detail `1 / 1.0 / dormant` — the
    // table rendered "—" (unknown) while the detail page asserted
    // "100% marked read".
    //
    // The seed reproduces exactly that shape: messages in the latest
    // timeseries calendar month but NONE in the rolling last 30 days.
    // Pre-fix, the detail read 5 / 1.0 / 'new' off the timeseries row
    // while the list read 0 / null / 'down' off the rolling window.
    it('reports identical monthlyVolume/readRate/volumeTrend from the list and the detail path', async () => {
      const s = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'window-drift@x.com',
        firstSeenAt: new Date(Date.now() - 300 * 86400_000),
        lastSeenAt: new Date(Date.now() - 45 * 86400_000),
      });
      // A second sender with recent traffic — keeps the correlated
      // subqueries honest (a tautology would fold these counts in).
      const noisy = await seedSender(db, {
        mailboxAccountId: mailboxId,
        email: 'window-drift-noise@x.com',
        lastSeenAt: new Date(Date.now() - 1 * 86400_000),
      });
      await seedRollingMessages({
        mailboxAccountId: mailboxId,
        senderKey: noisy.senderKey,
        count: 6,
        daysAgo: 3,
        readCount: 6,
      });
      // Target's real messages: 45d ago → OUTSIDE the rolling 30d
      // window, INSIDE the 30-90d trend baseline.
      await seedRollingMessages({
        mailboxAccountId: mailboxId,
        senderKey: s.senderKey,
        count: 3,
        daysAgo: 45,
        readCount: 3,
      });
      // The legacy source the detail path used to read: a fully-read
      // row in the CURRENT calendar month. Nothing may read this for
      // the three scalar fields any more.
      await seedTimeseries(db, {
        mailboxAccountId: mailboxId,
        senderKey: s.senderKey,
        yearMonth: startOfMonthIsoForTest(new Date()),
        volume: 5,
        readCount: 5,
      });

      const [detail, rows] = await Promise.all([
        svc.getSenderDetail(mailboxId, s.id),
        svc.listSenders({
          mailboxAccountId: mailboxId,
          category: null,
          cursor: null,
          limit: 25,
        }),
      ]);
      const listRow = rows.find((r) => r.id === s.id);
      expect(detail).not.toBeNull();
      expect(listRow).toBeDefined();

      // The invariant: same sender, same facts, both endpoints.
      expect(detail!.monthlyVolume).toBe(listRow!.monthlyVolume);
      expect(detail!.readRate).toBe(listRow!.readRate);
      expect(detail!.volumeTrend).toBe(listRow!.volumeTrend);

      // Pin the absolute values so the test can't pass by both paths
      // regressing to the legacy timeseries read together.
      expect(detail!.monthlyVolume).toBe(0);
      // NULL, not 0 — "no messages in the window" is not "never read".
      expect(detail!.readRate).toBeNull();
      expect(detail!.volumeTrend).toBe('down');
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

  describe('getSenderSummary (rolling 30d + 8 buckets)', () => {
    /**
     * Seed an inbound message dated `daysAgo` ago so it falls in (or
     * out of) the rolling 30/60/90/180-day windows the SQL uses.
     */
    async function seedRecentMessage(
      target: string,
      senderKey: string,
      daysAgo: number,
    ): Promise<void> {
      await seedMessage(db, {
        mailboxAccountId: target,
        senderKey,
        internalDate: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      });
    }

    /**
     * Seed an OUTBOUND msg (user replied) carrying `recipientEmail` in
     * the `recipient_emails` array. The summary's `replied` CTE picks
     * this up and the personScore gets the +5 REPLIED_WEIGHT.
     */
    async function seedReply(target: string, recipientEmail: string): Promise<void> {
      await db.insert(mailMessages).values({
        mailboxAccountId: target,
        providerMessageId: `out-${randomUUID()}`,
        providerThreadId: `thr-${randomUUID()}`,
        senderKey: senderKeyFor(`self-${target}@user.local`),
        subject: 'Re: hi',
        snippet: '',
        internalDate: new Date(),
        isUnread: false,
        isOutbound: true,
        recipientEmails: [recipientEmail],
      });
    }

    async function _legacy_seedSummaryFixture(targetMailbox: string) {
      // s1 — Protect via explicit `is_protected` (beats any decision verdict).
      const s1 = await seedSender(db, {
        mailboxAccountId: targetMailbox,
        displayName: 'Protected Inc.',
        email: 'protect@example.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      await db.insert(senderPolicies).values({
        mailboxAccountId: targetMailbox,
        senderKey: s1.senderKey,
        isProtected: true,
        protectionReason: 'user_defined',
        protectionSetAt: new Date('2026-05-01T00:00:00Z'),
      });
      // Even with a high-confidence unsubscribe verdict, the policy wins.
      await seedTriageDecision(db, {
        mailboxAccountId: targetMailbox,
        senderKey: s1.senderKey,
        verdict: 'unsubscribe',
        confidence: '0.95',
        producedAt: new Date('2026-05-02T00:00:00Z'),
      });
      await seedTimeseries(db, {
        mailboxAccountId: targetMailbox,
        senderKey: s1.senderKey,
        yearMonth: '2026-05-01',
        volume: 10,
        readCount: 1,
      });

      // s2 — explicit protection routes the sender into `protect`.
      const s2 = await seedSender(db, {
        mailboxAccountId: targetMailbox,
        displayName: 'Protected Friend',
        email: 'protected@friend.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      await db.insert(senderPolicies).values({
        mailboxAccountId: targetMailbox,
        senderKey: s2.senderKey,
        isProtected: true,
        protectionReason: 'user_defined',
      });
      await seedTimeseries(db, {
        mailboxAccountId: targetMailbox,
        senderKey: s2.senderKey,
        yearMonth: '2026-05-01',
        volume: 5,
        readCount: 5,
      });

      // s3 — Cleanup (unsubscribe verdict at confidence = 0.75, the
      // exact boundary; the FE's gate is `>= 0.75`, so this must count).
      const s3 = await seedSender(db, {
        mailboxAccountId: targetMailbox,
        displayName: 'Promo Daily',
        email: 'noreply@promo.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      await seedTriageDecision(db, {
        mailboxAccountId: targetMailbox,
        senderKey: s3.senderKey,
        verdict: 'unsubscribe',
        confidence: '0.75',
        producedAt: new Date('2026-05-02T00:00:00Z'),
      });
      await seedTimeseries(db, {
        mailboxAccountId: targetMailbox,
        senderKey: s3.senderKey,
        yearMonth: '2026-05-01',
        volume: 50,
        readCount: 1,
      });

      // s4 — Later (archive verdict, confidence well above the gate).
      const s4 = await seedSender(db, {
        mailboxAccountId: targetMailbox,
        displayName: 'Newsletter Weekly',
        email: 'news@weekly.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      await seedTriageDecision(db, {
        mailboxAccountId: targetMailbox,
        senderKey: s4.senderKey,
        verdict: 'archive',
        confidence: '0.90',
        producedAt: new Date('2026-05-02T00:00:00Z'),
      });
      await seedTimeseries(db, {
        mailboxAccountId: targetMailbox,
        senderKey: s4.senderKey,
        yearMonth: '2026-05-01',
        volume: 20,
        readCount: 4,
      });

      // s5 — People: an unsubscribe verdict at confidence 0.74 (just
      // below the gate). The FE drops this to `people`; the BE must too.
      // Also exercises `needsReview` (a decision row exists even though
      // it doesn't surface as a recommendation).
      const s5 = await seedSender(db, {
        mailboxAccountId: targetMailbox,
        displayName: 'Maybe Cleanup',
        email: 'maybe@cleanup.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });
      await seedTriageDecision(db, {
        mailboxAccountId: targetMailbox,
        senderKey: s5.senderKey,
        verdict: 'unsubscribe',
        confidence: '0.74',
        producedAt: new Date('2026-05-02T00:00:00Z'),
      });
      await seedTimeseries(db, {
        mailboxAccountId: targetMailbox,
        senderKey: s5.senderKey,
        yearMonth: '2026-05-01',
        volume: 30,
        readCount: 6,
      });

      // s6 — People: no decision, no policy, no timeseries. Touches
      // every `null` / `0` fallback in the SQL.
      await seedSender(db, {
        mailboxAccountId: targetMailbox,
        displayName: 'Plain Sender',
        email: 'plain@nopolicy.com',
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      });

      return { s1, s2, s3, s4, s5 };
    }

    /**
     * The new contract — eight mutually-exclusive buckets in priority
     * order. We seed one sender per bucket against `mailboxId`, then
     * assert each lands in exactly the expected bucket.
     */
    async function seedAllBuckets(target: string) {
      const RECENT = 5; // days ago — within the 30-day active window
      const QUIETD = 90; // days ago — within QUIET_DAYS..DORMANT_DAYS
      const DORMD = 365; // days ago — past DORMANT_DAYS

      // 1) ONE-TIME — total ≤ 2 lifetime, even if otherwise looks personal.
      const oneTime = await seedSender(db, {
        mailboxAccountId: target,
        displayName: 'One Shot',
        email: 'oneshot@gmail.com',
        lastSeenAt: new Date(Date.now() - RECENT * 86400_000),
      });
      // total_received default is 0; only 1 msg.
      await db.update(senders).set({ totalReceived: 2 }).where(eq(senders.id, oneTime.id));
      await seedRecentMessage(target, oneTime.senderKey, RECENT);

      // 2) PROTECT — is_protected wins regardless of other signals.
      const protectSender = await seedSender(db, {
        mailboxAccountId: target,
        displayName: 'Boss',
        email: 'boss@company.com',
        lastSeenAt: new Date(Date.now() - RECENT * 86400_000),
      });
      await db.update(senders).set({ totalReceived: 50 }).where(eq(senders.id, protectSender.id));
      await db.insert(senderPolicies).values({
        mailboxAccountId: target,
        senderKey: protectSender.senderKey,
        isProtected: true,
        protectionReason: 'user_defined',
        protectionSetAt: new Date(),
      });
      // Even with a high-confidence unsub, protect wins:
      await seedTriageDecision(db, {
        mailboxAccountId: target,
        senderKey: protectSender.senderKey,
        verdict: 'unsubscribe',
        confidence: '0.95',
        producedAt: new Date(),
      });

      // 3) PEOPLE — score ≥ 3 via REPLIED + FREE_MAIL (>= 5 + 3 = 8).
      const person = await seedSender(db, {
        mailboxAccountId: target,
        displayName: 'Friend',
        email: 'friend@gmail.com',
        lastSeenAt: new Date(Date.now() - RECENT * 86400_000),
      });
      await db.update(senders).set({ totalReceived: 30 }).where(eq(senders.id, person.id));
      await seedReply(target, 'friend@gmail.com');
      await seedRecentMessage(target, person.senderKey, RECENT);

      // 4) NEEDS_REVIEW — engine recommendation, conf ≥ 0.75, active 30d,
      //    score < 3 (so not people).
      const needsReview = await seedSender(db, {
        mailboxAccountId: target,
        displayName: 'Promo Daily',
        email: 'noreply@promo.com', // role-prefix LP → -4 score, no replied → still not people
        lastSeenAt: new Date(Date.now() - RECENT * 86400_000),
        unsubscribeMethod: 'one_click',
      });
      await db.update(senders).set({ totalReceived: 50 }).where(eq(senders.id, needsReview.id));
      await seedTriageDecision(db, {
        mailboxAccountId: target,
        senderKey: needsReview.senderKey,
        verdict: 'unsubscribe',
        confidence: '0.75',
        producedAt: new Date(),
      });
      await seedRecentMessage(target, needsReview.senderKey, RECENT);

      // 5) QUIET — silent 60-180d, recurring (≥3 total), no recommendation.
      const quietSender = await seedSender(db, {
        mailboxAccountId: target,
        displayName: 'Tapered Brand',
        email: 'newsletter@tapered.org',
        lastSeenAt: new Date(Date.now() - QUIETD * 86400_000),
      });
      await db.update(senders).set({ totalReceived: 20 }).where(eq(senders.id, quietSender.id));

      // 6) DORMANT — silent ≥180d, recurring.
      const dormantSender = await seedSender(db, {
        mailboxAccountId: target,
        displayName: 'Long Gone',
        email: 'someone@oldco.com',
        firstSeenAt: new Date(Date.now() - 2 * DORMD * 86400_000),
        lastSeenAt: new Date(Date.now() - DORMD * 86400_000),
      });
      await db.update(senders).set({ totalReceived: 40 }).where(eq(senders.id, dormantSender.id));

      // 7) BULK — has unsub signal, no engine recommendation, not active enough for needs_review.
      const bulkSender = await seedSender(db, {
        mailboxAccountId: target,
        displayName: 'Bulk Brand',
        email: 'mail@bulk.brand.com',
        lastSeenAt: new Date(Date.now() - RECENT * 86400_000),
        unsubscribeMethod: 'one_click',
      });
      await db.update(senders).set({ totalReceived: 15 }).where(eq(senders.id, bulkSender.id));
      // No triage decision row.

      // 8) OTHER — recurring, recent, no policy, no engine rec, no bulk
      //    signals, no replied/free-mail/own-domain. Plain corp domain.
      const otherSender = await seedSender(db, {
        mailboxAccountId: target,
        displayName: 'Mystery Corp',
        email: 'hello@mystery-corp.io',
        lastSeenAt: new Date(Date.now() - RECENT * 86400_000),
      });
      await db.update(senders).set({ totalReceived: 10 }).where(eq(senders.id, otherSender.id));

      return {
        oneTime,
        protectSender,
        person,
        needsReview,
        quietSender,
        dormantSender,
        bulkSender,
        otherSender,
      };
    }

    it('assigns each of the 8 buckets exactly once for the canonical fixture', async () => {
      await seedAllBuckets(mailboxId);
      const summary = await svc.getSenderSummary({ mailboxAccountId: mailboxId });

      expect(summary.totalSenders).toBe(8);
      // Each bucket should contain exactly one sender from the fixture.
      expect(summary.byBucket).toEqual({
        one_time: 1,
        protect: 1,
        people: 1,
        needs_review: 1,
        quiet: 1,
        dormant: 1,
        bulk: 1,
        other: 1,
      });
      // Aliases for KPI cells must match the bucket counts.
      expect(summary.protected).toBe(1);
      expect(summary.needsReview).toBe(1);
    });

    it('priority: PROTECT wins over engine recommendation (sender has high-conf unsub but is_protected)', async () => {
      await seedAllBuckets(mailboxId);
      const summary = await svc.getSenderSummary({ mailboxAccountId: mailboxId });
      // The protect sender has a 0.95-confidence unsubscribe verdict + is
      // active in last 30d → would otherwise be needs_review. Protect wins.
      // needs_review still counts the OTHER sender (noreply@promo.com), so total is 1.
      expect(summary.byBucket.protect).toBe(1);
      expect(summary.byBucket.needs_review).toBe(1);
    });

    it('PEOPLE: reply (+5) + free-mail (+3) beats threshold, even without other signals', async () => {
      await seedAllBuckets(mailboxId);
      const summary = await svc.getSenderSummary({ mailboxAccountId: mailboxId });
      expect(summary.byBucket.people).toBe(1);
    });

    it('NEEDS_REVIEW requires recent activity — a dormant high-conf cleanup falls through to dormant', async () => {
      // Standalone fixture — sender with strong unsub verdict but silent
      // >180d. Without the active-30d gate this would surface as
      // needs_review; with the gate it falls through to dormant.
      const s = await seedSender(db, {
        mailboxAccountId: mailboxId,
        displayName: 'Stale Promo',
        email: 'noreply@stale-promo.com',
        firstSeenAt: new Date(Date.now() - 2 * 365 * 86400_000),
        lastSeenAt: new Date(Date.now() - 365 * 86400_000), // 1y ago
        unsubscribeMethod: 'one_click',
      });
      await db.update(senders).set({ totalReceived: 20 }).where(eq(senders.id, s.id));
      await seedTriageDecision(db, {
        mailboxAccountId: mailboxId,
        senderKey: s.senderKey,
        verdict: 'unsubscribe',
        confidence: '0.95',
        producedAt: new Date(),
      });
      const summary = await svc.getSenderSummary({ mailboxAccountId: mailboxId });
      expect(summary.byBucket.needs_review).toBe(0);
      expect(summary.byBucket.dormant).toBe(1);
    });

    it('aggregates: totalSenders + activeSenders + last30dVolume + noiseReducible', async () => {
      await seedAllBuckets(mailboxId);
      const summary = await svc.getSenderSummary({ mailboxAccountId: mailboxId });
      expect(summary.totalSenders).toBe(8);
      // active = senders with ≥1 msg in last 30d. We seeded recent msgs for
      // one_time (1), person (1), needs_review (1). Others have no last30 msgs.
      expect(summary.activeSenders).toBe(3);
      // last30dVolume = sum of msgs30 across all in-scope senders = 3.
      expect(summary.last30dVolume).toBe(3);
      // cleanup_recent_volume = msgs30 of needs_review sender only = 1.
      // noiseReducible = round(1 / 3 * 100) = 33.
      expect(summary.noiseReducible).toBe(33);
    });

    it('includeOneTime=false drops one-time senders from EVERY aggregate', async () => {
      await seedAllBuckets(mailboxId);
      const withOne = await svc.getSenderSummary({ mailboxAccountId: mailboxId });
      const withoutOne = await svc.getSenderSummary({
        mailboxAccountId: mailboxId,
        includeOneTime: false,
      });
      expect(withOne.totalSenders).toBe(8);
      expect(withoutOne.totalSenders).toBe(7);
      expect(withoutOne.byBucket.one_time).toBe(0);
      // Other buckets remain stable — only one_time is excluded.
      expect(withoutOne.byBucket.protect).toBe(1);
      expect(withoutOne.byBucket.people).toBe(1);
      expect(withoutOne.byBucket.needs_review).toBe(1);
    });

    it('q narrows every aggregate in lockstep (chips + KPI + hero stay synchronised with rows)', async () => {
      await seedAllBuckets(mailboxId);
      // "promo" matches the noreply@promo.com sender (needs_review bucket).
      const filtered = await svc.getSenderSummary({
        mailboxAccountId: mailboxId,
        q: 'promo',
      });
      expect(filtered.totalSenders).toBe(1);
      expect(filtered.byBucket.needs_review).toBe(1);
      expect(filtered.byBucket).toMatchObject({
        one_time: 0,
        protect: 0,
        people: 0,
        quiet: 0,
        dormant: 0,
        bulk: 0,
        other: 0,
      });
    });

    it('empty mailbox aggregates safely (no NaN, all zeros)', async () => {
      const empty = await seedMailbox(db, 'b-empty');
      const summary = await svc.getSenderSummary({ mailboxAccountId: empty });
      expect(summary.totalSenders).toBe(0);
      expect(summary.activeSenders).toBe(0);
      expect(summary.last30dVolume).toBe(0);
      expect(summary.noiseReducible).toBe(0);
      expect(summary.byBucket).toEqual({
        one_time: 0,
        protect: 0,
        people: 0,
        needs_review: 0,
        quiet: 0,
        dormant: 0,
        bulk: 0,
        other: 0,
      });
    });

    it('isolates summary by mailbox (tenant safety — overlapping sender_keys)', async () => {
      await seedAllBuckets(mailboxId);
      const otherMailbox = await seedMailbox(db, 'b');
      await seedAllBuckets(otherMailbox);
      const a = await svc.getSenderSummary({ mailboxAccountId: mailboxId });
      const b = await svc.getSenderSummary({ mailboxAccountId: otherMailbox });
      // Both fixtures have 8 senders; counts MUST be independent.
      expect(a.totalSenders).toBe(8);
      expect(b.totalSenders).toBe(8);
      expect(a.byBucket).toEqual(b.byBucket);
    });

    it('does NOT leak email addresses from the replied CTE (D7/D228 privacy)', async () => {
      // The `replied` CTE inside `getSenderSummary` materialises every
      // outbound recipient address (the user's personal address book).
      // The outer SELECT projects only integer aggregates so the set
      // never crosses the SQL boundary today — but a future regression
      // that JOINs the CTE into a wire field (or adds a debug log)
      // would silently exfiltrate it. This guard locks the contract:
      // the JSON-stringified summary response MUST NOT contain any
      // email-shaped strings. Tightly scoped to summary so the test is
      // cheap and cannot pick up email-like strings from elsewhere.
      await seedAllBuckets(mailboxId);
      const summary = await svc.getSenderSummary({ mailboxAccountId: mailboxId });
      const serialised = JSON.stringify(summary);
      // Generic email shape — `local@domain.tld`. The fixture seeds
      // recipients like `chintan@example.com` via the outbound msgs,
      // so this catches any leak from those into the response body.
      const EMAIL_SHAPE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
      expect(serialised).not.toMatch(EMAIL_SHAPE);
    });
  });
});
