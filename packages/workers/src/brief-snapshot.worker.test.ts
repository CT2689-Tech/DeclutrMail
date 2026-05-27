import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import {
  briefRuns,
  mailMessages,
  mailboxAccounts,
  schema,
  senderPolicies,
  senders,
  triageDecisions,
  users,
  workspaces,
} from '@declutrmail/db';
import { describe, expect, it, vi } from 'vitest';

import type { BriefLlmPort } from './brief-narrative.js';
import { BriefSnapshotWorker } from './brief-snapshot.worker.js';
import { scheduledAtMinute as briefSnapshotScheduledAtMinute } from './brief-snapshot.queue.js';
import type { WorkerContext } from './worker-context.js';

/**
 * BriefSnapshotWorker integration tests (D61, D62, D63, D67, D69, D70).
 *
 * Runs the real worker against an in-process PGlite database with every
 * migration applied. Covers the D63 categorization, D67 VIP elevation,
 * D69 frozen-once invariant, D70 empty-day branch, and idempotency.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');
const NOW = new Date('2026-05-25T08:00:00Z');
const TODAY_LOCAL = '2026-05-25';
const YESTERDAY_AT = (hour: number) =>
  new Date(`2026-05-24T${hour.toString().padStart(2, '0')}:00:00Z`);

type Db = ReturnType<typeof drizzle<typeof schema>>;

async function freshDb(): Promise<Db> {
  const pg = new PGlite({ extensions: { citext } });
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await pg.query(trimmed);
      }
    }
  }
  return drizzle(pg, { schema });
}

async function seedMailbox(
  db: Db,
  email = 'owner@example.com',
): Promise<{ workspaceId: string; mailboxAccountId: string }> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS-${email}` })
    .returning({
      id: workspaces.id,
    });
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
  return { workspaceId: ws!.id, mailboxAccountId: mb!.id };
}

interface SeedSenderInput {
  email: string;
  senderKey: string;
  displayName?: string;
  isVip?: boolean;
  verdict?: 'keep' | 'archive' | 'unsubscribe' | 'later';
}

async function seedSender(db: Db, mailboxAccountId: string, input: SeedSenderInput): Promise<void> {
  await db.insert(senders).values({
    mailboxAccountId,
    senderKey: input.senderKey,
    displayName: input.displayName ?? input.email,
    email: input.email,
    domain: input.email.split('@')[1] ?? '',
    gmailCategory: 'promotions',
    firstSeenAt: new Date('2024-01-01T00:00:00Z'),
    lastSeenAt: NOW,
  });
  if (input.isVip) {
    await db.insert(senderPolicies).values({
      mailboxAccountId,
      senderKey: input.senderKey,
      policyType: 'keep',
      isVip: true,
    });
  }
  if (input.verdict) {
    await db.insert(triageDecisions).values({
      mailboxAccountId,
      senderKey: input.senderKey,
      verdict: input.verdict,
      confidence: '0.90',
      reasoning: 'test',
      generatedBy: 'template',
      producedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
  }
}

interface SeedMessageInput {
  mailboxAccountId: string;
  senderKey: string;
  subject?: string;
  snippet?: string;
  internalDate: Date;
  isOutbound?: boolean;
  idSuffix?: string;
}

async function seedMessage(db: Db, input: SeedMessageInput): Promise<void> {
  const suffix = input.idSuffix ?? `${input.senderKey.slice(0, 6)}-${input.internalDate.getTime()}`;
  await db.insert(mailMessages).values({
    mailboxAccountId: input.mailboxAccountId,
    providerMessageId: `msg-${suffix}`,
    providerThreadId: `thr-${suffix}`,
    senderKey: input.senderKey,
    subject: input.subject ?? '',
    snippet: input.snippet ?? '',
    internalDate: input.internalDate,
    labelIds: input.isOutbound ? ['SENT'] : ['INBOX'],
    isUnread: !input.isOutbound,
    isOutbound: input.isOutbound ?? false,
  });
}

const FAKE_CTX: WorkerContext = {
  jobId: 'test',
  workerName: 'BriefSnapshotWorker',
  attempt: 1,
  maxAttempts: 3,
  startedAt: new Date(),
  policy: 'cronPolicy',
};

const KEY_BOSS = 'a'.repeat(64);
const KEY_BANK = 'b'.repeat(64);
const KEY_PROMO = 'c'.repeat(64);
const KEY_NEWS = 'd'.repeat(64);

describe('BriefSnapshotWorker', () => {
  it('D70 — empty day produces an empty-section brief with calm narrative', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);

    const worker = new BriefSnapshotWorker({ db: db as never, now: () => NOW });
    const result = await worker.processJob(
      { scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) },
      FAKE_CTX,
    );
    expect(result.briefsGenerated).toBe(1);
    expect(result.emptyBriefs).toBe(1);

    const [row] = await db
      .select({
        runDateLocal: briefRuns.runDateLocal,
        generatedBy: briefRuns.generatedBy,
        briefPayload: briefRuns.briefPayload,
      })
      .from(briefRuns)
      .where(eq(briefRuns.mailboxAccountId, mailboxAccountId));
    expect(row!.runDateLocal).toBe(TODAY_LOCAL);
    expect(row!.generatedBy).toBe('template');
    expect(row!.briefPayload.reply).toEqual([]);
    expect(row!.briefPayload.fyi).toEqual([]);
    expect(row!.briefPayload.noise).toEqual([]);
    expect(row!.briefPayload.narrative).toContain('quiet yesterday');
  });

  it('D63 — categorizes by triage verdict (archive/unsubscribe → noise; later → fyi; keep → reply)', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);

    await seedSender(db, mailboxAccountId, {
      email: 'boss@example.com',
      senderKey: KEY_BOSS,
      displayName: 'Boss',
      verdict: 'keep',
    });
    await seedSender(db, mailboxAccountId, {
      email: 'bank@example.com',
      senderKey: KEY_BANK,
      displayName: 'Bank',
      verdict: 'later',
    });
    await seedSender(db, mailboxAccountId, {
      email: 'promo@example.com',
      senderKey: KEY_PROMO,
      displayName: 'Promo',
      verdict: 'archive',
    });
    await seedSender(db, mailboxAccountId, {
      email: 'news@example.com',
      senderKey: KEY_NEWS,
      displayName: 'News',
      verdict: 'unsubscribe',
    });

    await seedMessage(db, {
      mailboxAccountId,
      senderKey: KEY_BOSS,
      subject: 'Q4 plans',
      internalDate: YESTERDAY_AT(10),
    });
    await seedMessage(db, {
      mailboxAccountId,
      senderKey: KEY_BANK,
      subject: 'Statement',
      internalDate: YESTERDAY_AT(11),
    });
    await seedMessage(db, {
      mailboxAccountId,
      senderKey: KEY_PROMO,
      subject: 'Sale',
      internalDate: YESTERDAY_AT(12),
    });
    await seedMessage(db, {
      mailboxAccountId,
      senderKey: KEY_NEWS,
      subject: 'Newsletter',
      internalDate: YESTERDAY_AT(13),
    });

    const worker = new BriefSnapshotWorker({ db: db as never, now: () => NOW });
    await worker.processJob({ scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) }, FAKE_CTX);

    const [row] = await db
      .select({ briefPayload: briefRuns.briefPayload })
      .from(briefRuns)
      .where(eq(briefRuns.mailboxAccountId, mailboxAccountId));
    expect(row!.briefPayload.reply.map((r) => r.senderName)).toEqual(['Boss']);
    expect(row!.briefPayload.fyi.map((r) => r.senderName)).toEqual(['Bank']);
    expect(row!.briefPayload.noise.map((r) => r.senderName).sort()).toEqual(['News', 'Promo']);
  });

  it('D67 — VIP auto-elevates to Reply regardless of engine verdict', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);

    // VIP with verdict=archive — should still land in Reply.
    await seedSender(db, mailboxAccountId, {
      email: 'vip@example.com',
      senderKey: KEY_BOSS,
      displayName: 'VIP Person',
      isVip: true,
      verdict: 'archive',
    });
    await seedMessage(db, {
      mailboxAccountId,
      senderKey: KEY_BOSS,
      subject: 'Important',
      internalDate: YESTERDAY_AT(10),
    });

    const worker = new BriefSnapshotWorker({ db: db as never, now: () => NOW });
    await worker.processJob({ scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) }, FAKE_CTX);

    const [row] = await db
      .select({ briefPayload: briefRuns.briefPayload })
      .from(briefRuns)
      .where(eq(briefRuns.mailboxAccountId, mailboxAccountId));
    expect(row!.briefPayload.reply).toHaveLength(1);
    expect(row!.briefPayload.reply[0]!.isVip).toBe(true);
    expect(row!.briefPayload.reply[0]!.senderName).toBe('VIP Person');
    expect(row!.briefPayload.noise).toHaveLength(0);
  });

  it('D63 — reply section caps at 6, VIPs win the cap (sortVipFirst)', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);

    // 8 reply candidates — 2 VIPs (will lead) + 6 normals (only 4 fit).
    for (let i = 0; i < 8; i += 1) {
      const key = `${i}`.repeat(64).slice(0, 64);
      const isVip = i < 2;
      await seedSender(db, mailboxAccountId, {
        email: `s${i}@example.com`,
        senderKey: key,
        displayName: isVip ? `VIP${i}` : `Normal${i}`,
        isVip,
        verdict: 'keep',
      });
      await seedMessage(db, {
        mailboxAccountId,
        senderKey: key,
        subject: `subj-${i}`,
        internalDate: YESTERDAY_AT(10 + i),
      });
    }

    const worker = new BriefSnapshotWorker({ db: db as never, now: () => NOW });
    await worker.processJob({ scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) }, FAKE_CTX);

    const [row] = await db
      .select({ briefPayload: briefRuns.briefPayload })
      .from(briefRuns)
      .where(eq(briefRuns.mailboxAccountId, mailboxAccountId));
    expect(row!.briefPayload.reply).toHaveLength(6);
    // VIPs lead.
    expect(row!.briefPayload.reply.slice(0, 2).map((r) => r.isVip)).toEqual([true, true]);
    expect(
      row!.briefPayload.reply
        .slice(0, 2)
        .map((r) => r.senderName)
        .sort(),
    ).toEqual(['VIP0', 'VIP1']);
  });

  it('D63 — fyi section caps at 4', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);

    for (let i = 0; i < 7; i += 1) {
      const key = `f${i}`.padEnd(64, '0').slice(0, 64);
      await seedSender(db, mailboxAccountId, {
        email: `f${i}@example.com`,
        senderKey: key,
        verdict: 'later',
      });
      await seedMessage(db, {
        mailboxAccountId,
        senderKey: key,
        internalDate: YESTERDAY_AT(10 + i),
      });
    }

    const worker = new BriefSnapshotWorker({ db: db as never, now: () => NOW });
    await worker.processJob({ scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) }, FAKE_CTX);

    const [row] = await db
      .select({ briefPayload: briefRuns.briefPayload })
      .from(briefRuns)
      .where(eq(briefRuns.mailboxAccountId, mailboxAccountId));
    expect(row!.briefPayload.fyi).toHaveLength(4);
  });

  it('D63 — noise is uncapped and aggregates message counts per sender', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);

    await seedSender(db, mailboxAccountId, {
      email: 'promo@example.com',
      senderKey: KEY_PROMO,
      displayName: 'Promo',
      verdict: 'archive',
    });
    // 5 messages from the same noise sender — should collapse to 1
    // BriefSenderGroup with messageCount=5.
    for (let i = 0; i < 5; i += 1) {
      await seedMessage(db, {
        mailboxAccountId,
        senderKey: KEY_PROMO,
        internalDate: YESTERDAY_AT(10 + i),
        idSuffix: `promo-${i}`,
      });
    }

    const worker = new BriefSnapshotWorker({ db: db as never, now: () => NOW });
    await worker.processJob({ scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) }, FAKE_CTX);

    const [row] = await db
      .select({ briefPayload: briefRuns.briefPayload })
      .from(briefRuns)
      .where(eq(briefRuns.mailboxAccountId, mailboxAccountId));
    expect(row!.briefPayload.noise).toHaveLength(1);
    expect(row!.briefPayload.noise[0]!.messageCount).toBe(5);
    expect(row!.briefPayload.noise[0]!.messageIds).toHaveLength(5);
  });

  it('outbound (SENT) messages are excluded — Brief is yesterday INBOUND only', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);

    await seedSender(db, mailboxAccountId, {
      email: 'recipient@example.com',
      senderKey: KEY_BOSS,
      verdict: 'keep',
    });
    await seedMessage(db, {
      mailboxAccountId,
      senderKey: KEY_BOSS,
      subject: 'My reply',
      internalDate: YESTERDAY_AT(10),
      isOutbound: true,
    });

    const worker = new BriefSnapshotWorker({ db: db as never, now: () => NOW });
    const result = await worker.processJob(
      { scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) },
      FAKE_CTX,
    );
    expect(result.emptyBriefs).toBe(1);
  });

  it('D69 — second run for the same (mailbox, date) is a no-op (frozen-once)', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);

    await seedSender(db, mailboxAccountId, {
      email: 'boss@example.com',
      senderKey: KEY_BOSS,
      verdict: 'keep',
    });
    await seedMessage(db, {
      mailboxAccountId,
      senderKey: KEY_BOSS,
      subject: 'first',
      internalDate: YESTERDAY_AT(10),
    });

    const worker = new BriefSnapshotWorker({ db: db as never, now: () => NOW });
    const r1 = await worker.processJob(
      { scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) },
      FAKE_CTX,
    );
    expect(r1.briefsGenerated).toBe(1);

    // Now add another inbound message — simulating "the world changed
    // since 8am". The second run must NOT regenerate the Brief.
    await seedMessage(db, {
      mailboxAccountId,
      senderKey: KEY_BOSS,
      subject: 'later in day',
      internalDate: YESTERDAY_AT(15),
      idSuffix: 'late',
    });

    const r2 = await worker.processJob(
      { scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) },
      FAKE_CTX,
    );
    expect(r2.briefsGenerated).toBe(0);

    const allRows = await db
      .select({ id: briefRuns.id, briefPayload: briefRuns.briefPayload })
      .from(briefRuns)
      .where(eq(briefRuns.mailboxAccountId, mailboxAccountId));
    expect(allRows).toHaveLength(1);
    // First run's payload is preserved verbatim.
    expect(allRows[0]!.briefPayload.reply).toHaveLength(1);
    expect(allRows[0]!.briefPayload.reply[0]!.subject).toBe('first');
  });

  it('senders without a triage decision land in Reply (conservative default)', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);

    await seedSender(db, mailboxAccountId, {
      email: 'unknown@example.com',
      senderKey: KEY_BOSS,
      displayName: 'Unknown',
      // No verdict — engine hasn't scored yet.
    });
    await seedMessage(db, {
      mailboxAccountId,
      senderKey: KEY_BOSS,
      internalDate: YESTERDAY_AT(10),
    });

    const worker = new BriefSnapshotWorker({ db: db as never, now: () => NOW });
    await worker.processJob({ scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) }, FAKE_CTX);

    const [row] = await db
      .select({ briefPayload: briefRuns.briefPayload })
      .from(briefRuns)
      .where(eq(briefRuns.mailboxAccountId, mailboxAccountId));
    expect(row!.briefPayload.reply).toHaveLength(1);
    expect(row!.briefPayload.reply[0]!.senderName).toBe('Unknown');
  });

  it('idempotency key shape matches D225 cron contract', () => {
    const worker = new BriefSnapshotWorker({ db: {} as never });
    type WithProtectedKey = BriefSnapshotWorker & {
      getIdempotencyKey?: (payload: { scheduledAtMinute: string }) => string;
    };
    const key = (worker as WithProtectedKey).getIdempotencyKey?.({
      scheduledAtMinute: '2026-05-25T08:00',
    });
    expect(key).toBe('BriefSnapshotWorker:2026-05-25T08:00');
  });

  it('messages outside yesterday window (today + 2-days-ago) are excluded', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);

    await seedSender(db, mailboxAccountId, {
      email: 'boss@example.com',
      senderKey: KEY_BOSS,
      verdict: 'keep',
    });
    // Today (excluded — Brief is yesterday only)
    await seedMessage(db, {
      mailboxAccountId,
      senderKey: KEY_BOSS,
      internalDate: new Date('2026-05-25T06:00:00Z'),
      idSuffix: 'today',
    });
    // 2 days ago (excluded)
    await seedMessage(db, {
      mailboxAccountId,
      senderKey: KEY_BOSS,
      internalDate: new Date('2026-05-23T10:00:00Z'),
      idSuffix: 'two-ago',
    });

    const worker = new BriefSnapshotWorker({ db: db as never, now: () => NOW });
    const result = await worker.processJob(
      { scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) },
      FAKE_CTX,
    );
    expect(result.emptyBriefs).toBe(1);
  });

  it('does not leak briefs across mailboxes', async () => {
    const db = await freshDb();
    const a = await seedMailbox(db, 'a@example.com');
    const b = await seedMailbox(db, 'b@example.com');

    await seedSender(db, a.mailboxAccountId, {
      email: 'boss@example.com',
      senderKey: KEY_BOSS,
      verdict: 'keep',
    });
    await seedMessage(db, {
      mailboxAccountId: a.mailboxAccountId,
      senderKey: KEY_BOSS,
      subject: 'A-only',
      internalDate: YESTERDAY_AT(10),
    });

    const worker = new BriefSnapshotWorker({ db: db as never, now: () => NOW });
    await worker.processJob({ scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) }, FAKE_CTX);

    const aRows = await db
      .select({ id: briefRuns.id })
      .from(briefRuns)
      .where(
        and(
          eq(briefRuns.mailboxAccountId, a.mailboxAccountId),
          eq(briefRuns.runDateLocal, TODAY_LOCAL),
        ),
      );
    const bRows = await db
      .select({ id: briefRuns.id })
      .from(briefRuns)
      .where(
        and(
          eq(briefRuns.mailboxAccountId, b.mailboxAccountId),
          eq(briefRuns.runDateLocal, TODAY_LOCAL),
        ),
      );
    expect(aRows).toHaveLength(1);
    // Mailbox B has no yesterday inbound — still gets an empty-day brief.
    expect(bRows).toHaveLength(1);
  });

  it('one mailbox failure does not block other mailboxes (partial-failure resilience)', async () => {
    const db = await freshDb();
    const a = await seedMailbox(db, 'a@example.com');
    const b = await seedMailbox(db, 'b@example.com');

    // Both mailboxes have empty days — both would normally land an
    // empty-day brief. Inject a synthetic insert failure for the FIRST
    // `brief_runs` insert call; the second mailbox should still get
    // its Brief and `mailboxesFailed` should be 1.
    //
    // The proxy throws synchronously on the intercepted `.insert()`
    // call rather than rejecting an unhandled Promise — the worker's
    // chain is `.insert(...).values(...).onConflictDoNothing(...).returning(...)`
    // and synchronous throw is the cleanest way to interrupt that
    // chain inside the worker's try/catch.
    let injectedForFirst = false;
    const dbWithFault = new Proxy(db as never as Record<string, unknown>, {
      get(target, prop, receiver) {
        if (prop === 'insert') {
          return (table: unknown) => {
            if (table === briefRuns && !injectedForFirst) {
              injectedForFirst = true;
              throw new Error('synthetic brief_runs failure');
            }
            const origInsert = Reflect.get(target, prop, receiver) as (t: unknown) => unknown;
            return origInsert.call(target, table);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as never;

    const worker = new BriefSnapshotWorker({ db: dbWithFault, now: () => NOW });
    const result = await worker.processJob(
      { scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) },
      FAKE_CTX,
    );

    expect(result.mailboxesProcessed).toBe(2);
    expect(result.mailboxesFailed).toBe(1);
    // One mailbox still got its Brief.
    expect(result.briefsGenerated).toBe(1);

    // Confirm only one mailbox has a brief row.
    const aRows = await db
      .select({ id: briefRuns.id })
      .from(briefRuns)
      .where(eq(briefRuns.mailboxAccountId, a.mailboxAccountId));
    const bRows = await db
      .select({ id: briefRuns.id })
      .from(briefRuns)
      .where(eq(briefRuns.mailboxAccountId, b.mailboxAccountId));
    // Exactly one mailbox succeeded; the other one's row is missing.
    expect(aRows.length + bRows.length).toBe(1);
  });

  // ---------------------------------------------------------------------
  // D62 — Haiku LLM + deterministic template fallback.
  // ---------------------------------------------------------------------

  it('D62 — LLM happy path: narrative is the LLM text and generated_by = llm_haiku', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    await seedSender(db, mailboxAccountId, {
      email: 'boss@example.com',
      senderKey: KEY_BOSS,
      displayName: 'Boss',
      verdict: 'keep',
    });
    await seedMessage(db, {
      mailboxAccountId,
      senderKey: KEY_BOSS,
      subject: 'Q4 plans',
      snippet: 'Can we move the Q4 sync to Thursday?',
      internalDate: YESTERDAY_AT(10),
    });

    const llm: BriefLlmPort = {
      generateNarrative: vi
        .fn()
        .mockResolvedValue('Boss needs a reply about Q4 plans. Nothing else urgent.'),
    };
    const worker = new BriefSnapshotWorker({ db: db as never, now: () => NOW, llm });
    await worker.processJob({ scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) }, FAKE_CTX);

    const [row] = await db
      .select({
        generatedBy: briefRuns.generatedBy,
        briefPayload: briefRuns.briefPayload,
      })
      .from(briefRuns)
      .where(eq(briefRuns.mailboxAccountId, mailboxAccountId));
    expect(row!.generatedBy).toBe('llm_haiku');
    expect(row!.briefPayload.narrative).toBe(
      'Boss needs a reply about Q4 plans. Nothing else urgent.',
    );

    // The LLM port received exactly the allowlisted fields — no body,
    // no message ids, no senderKey. The bounded `BriefNarrativeInput`
    // contract is the privacy gate; assert here so a future regression
    // (e.g. someone adds raw `BriefItem` to the input) blows up the test.
    const generateNarrative = llm.generateNarrative as ReturnType<typeof vi.fn>;
    expect(generateNarrative).toHaveBeenCalledTimes(1);
    const arg = generateNarrative.mock.calls[0]![0];
    expect(arg.reply[0]).toEqual({
      senderName: 'Boss',
      senderEmail: 'boss@example.com',
      subject: 'Q4 plans',
      snippet: 'Can we move the Q4 sync to Thursday?',
      isVip: false,
    });
    // Defense-in-depth: no `senderKey`, no `messageIds`, no `body`
    // smuggled through the input.
    expect(arg.reply[0]).not.toHaveProperty('senderKey');
    expect(arg.reply[0]).not.toHaveProperty('messageIds');
    expect(arg.reply[0]).not.toHaveProperty('body');
  });

  it('D62 — LLM null return falls back to deterministic template', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    await seedSender(db, mailboxAccountId, {
      email: 'boss@example.com',
      senderKey: KEY_BOSS,
      verdict: 'keep',
    });
    await seedMessage(db, {
      mailboxAccountId,
      senderKey: KEY_BOSS,
      internalDate: YESTERDAY_AT(10),
    });

    const llm: BriefLlmPort = {
      generateNarrative: vi.fn().mockResolvedValue(null),
    };
    const worker = new BriefSnapshotWorker({ db: db as never, now: () => NOW, llm });
    await worker.processJob({ scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) }, FAKE_CTX);

    const [row] = await db
      .select({
        generatedBy: briefRuns.generatedBy,
        briefPayload: briefRuns.briefPayload,
      })
      .from(briefRuns)
      .where(eq(briefRuns.mailboxAccountId, mailboxAccountId));
    expect(row!.generatedBy).toBe('template');
    // Template narrative — single-reply, single-message phrasing.
    expect(row!.briefPayload.narrative).toBe('1 email needs a reply.');
  });

  it('D62 — LLM throw is caught and falls back to template (no throws contract)', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    await seedSender(db, mailboxAccountId, {
      email: 'boss@example.com',
      senderKey: KEY_BOSS,
      verdict: 'keep',
    });
    await seedMessage(db, {
      mailboxAccountId,
      senderKey: KEY_BOSS,
      internalDate: YESTERDAY_AT(10),
    });

    const llm: BriefLlmPort = {
      generateNarrative: vi.fn().mockRejectedValue(new Error('ECONNRESET')),
    };
    const worker = new BriefSnapshotWorker({ db: db as never, now: () => NOW, llm });
    // The worker must not propagate the throw — its outer try/catch in
    // `composeNarrative` is defense-in-depth for a port impl that
    // violates the "no throws" contract.
    await expect(
      worker.processJob({ scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) }, FAKE_CTX),
    ).resolves.toBeDefined();

    const [row] = await db
      .select({ generatedBy: briefRuns.generatedBy })
      .from(briefRuns)
      .where(eq(briefRuns.mailboxAccountId, mailboxAccountId));
    expect(row!.generatedBy).toBe('template');
  });

  it('D62 — LLM timeout falls back to template (wall-clock guard)', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    await seedSender(db, mailboxAccountId, {
      email: 'boss@example.com',
      senderKey: KEY_BOSS,
      verdict: 'keep',
    });
    await seedMessage(db, {
      mailboxAccountId,
      senderKey: KEY_BOSS,
      internalDate: YESTERDAY_AT(10),
    });

    // LLM stalls forever — the worker's `llmTimeoutMs` guard must trip.
    const llm: BriefLlmPort = {
      generateNarrative: () => new Promise<string | null>(() => undefined),
    };
    const worker = new BriefSnapshotWorker({
      db: db as never,
      now: () => NOW,
      llm,
      llmTimeoutMs: 25,
    });
    await worker.processJob({ scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) }, FAKE_CTX);

    const [row] = await db
      .select({ generatedBy: briefRuns.generatedBy })
      .from(briefRuns)
      .where(eq(briefRuns.mailboxAccountId, mailboxAccountId));
    expect(row!.generatedBy).toBe('template');
  });

  it('D62 — LLM empty/whitespace-only return falls back to template', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    await seedSender(db, mailboxAccountId, {
      email: 'boss@example.com',
      senderKey: KEY_BOSS,
      verdict: 'keep',
    });
    await seedMessage(db, {
      mailboxAccountId,
      senderKey: KEY_BOSS,
      internalDate: YESTERDAY_AT(10),
    });

    const llm: BriefLlmPort = {
      generateNarrative: vi.fn().mockResolvedValue('   \n   '),
    };
    const worker = new BriefSnapshotWorker({ db: db as never, now: () => NOW, llm });
    await worker.processJob({ scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) }, FAKE_CTX);

    const [row] = await db
      .select({ generatedBy: briefRuns.generatedBy })
      .from(briefRuns)
      .where(eq(briefRuns.mailboxAccountId, mailboxAccountId));
    expect(row!.generatedBy).toBe('template');
  });

  it('D70 — empty day does NOT call the LLM (no point spending a Haiku request)', async () => {
    const db = await freshDb();
    await seedMailbox(db);

    const generateNarrative = vi.fn();
    const llm: BriefLlmPort = { generateNarrative };
    const worker = new BriefSnapshotWorker({ db: db as never, now: () => NOW, llm });
    const result = await worker.processJob(
      { scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) },
      FAKE_CTX,
    );
    expect(result.emptyBriefs).toBe(1);
    // Empty-day short-circuit — the LLM port must NEVER be called on a
    // zero-message Brief. Wasted Haiku request + unstable phrasing for
    // a calm message that's better delivered verbatim per D70.
    expect(generateNarrative).not.toHaveBeenCalled();
  });

  it('D62 — LLM trims surrounding whitespace before storing the narrative', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    await seedSender(db, mailboxAccountId, {
      email: 'boss@example.com',
      senderKey: KEY_BOSS,
      verdict: 'keep',
    });
    await seedMessage(db, {
      mailboxAccountId,
      senderKey: KEY_BOSS,
      internalDate: YESTERDAY_AT(10),
    });

    const llm: BriefLlmPort = {
      generateNarrative: vi.fn().mockResolvedValue('\n\n  Boss needs a reply.  \n'),
    };
    const worker = new BriefSnapshotWorker({ db: db as never, now: () => NOW, llm });
    await worker.processJob({ scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) }, FAKE_CTX);

    const [row] = await db
      .select({ briefPayload: briefRuns.briefPayload })
      .from(briefRuns)
      .where(eq(briefRuns.mailboxAccountId, mailboxAccountId));
    expect(row!.briefPayload.narrative).toBe('Boss needs a reply.');
  });

  it('D7 — snippet is passed to the LLM but NEVER stored on brief_payload (privacy)', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    await seedSender(db, mailboxAccountId, {
      email: 'boss@example.com',
      senderKey: KEY_BOSS,
      verdict: 'keep',
    });
    await seedMessage(db, {
      mailboxAccountId,
      senderKey: KEY_BOSS,
      subject: 'Q4',
      snippet: 'super-secret-snippet-do-not-leak',
      internalDate: YESTERDAY_AT(10),
    });

    const generateNarrative = vi.fn().mockResolvedValue('Boss has a Q4 question.');
    const worker = new BriefSnapshotWorker({
      db: db as never,
      now: () => NOW,
      llm: { generateNarrative },
    });
    await worker.processJob({ scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) }, FAKE_CTX);

    // The LLM saw the snippet.
    expect(generateNarrative.mock.calls[0]![0].reply[0].snippet).toBe(
      'super-secret-snippet-do-not-leak',
    );

    // The persisted payload did NOT.
    const [row] = await db
      .select({ briefPayload: briefRuns.briefPayload })
      .from(briefRuns)
      .where(eq(briefRuns.mailboxAccountId, mailboxAccountId));
    const payloadJson = JSON.stringify(row!.briefPayload);
    expect(payloadJson).not.toContain('super-secret-snippet-do-not-leak');
    // Belt-and-suspenders: explicitly assert the BriefItem has no
    // `snippet` field.
    expect(row!.briefPayload.reply[0]).not.toHaveProperty('snippet');
  });

  it('emits a brief.generated structured log with generatedBy provenance', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    await seedSender(db, mailboxAccountId, {
      email: 'boss@example.com',
      senderKey: KEY_BOSS,
      verdict: 'keep',
    });
    await seedMessage(db, {
      mailboxAccountId,
      senderKey: KEY_BOSS,
      internalDate: YESTERDAY_AT(10),
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const worker = new BriefSnapshotWorker({ db: db as never, now: () => NOW });
      await worker.processJob({ scheduledAtMinute: briefSnapshotScheduledAtMinute(NOW) }, FAKE_CTX);
      // Find the brief.generated line among the structured logs.
      const briefLines = logSpy.mock.calls
        .map((args) => args[0])
        .filter((s): s is string => typeof s === 'string')
        .map((s) => {
          try {
            return JSON.parse(s) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter((o): o is Record<string, unknown> => o !== null && o.kind === 'brief.generated');
      expect(briefLines).toHaveLength(1);
      expect(briefLines[0]!.generatedBy).toBe('template');
      expect(briefLines[0]!.mailboxAccountId).toBe(mailboxAccountId);
      expect(briefLines[0]!.isEmpty).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });
});
