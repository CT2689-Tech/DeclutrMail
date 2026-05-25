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
import { describe, expect, it } from 'vitest';

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
    snippet: '',
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
});
