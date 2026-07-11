import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  activityLog,
  mailMessages,
  mailboxAccounts,
  schema,
  senderPolicies,
  senders,
  triageDecisions,
  undoJournal,
  users,
  workspaces,
} from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { TriageReadService } from './triage.read-service.js';

/**
 * TriageReadService.listQueue integration tests (D29, D30, D226).
 *
 * The load-bearing behaviour: a sender the user has DECIDED on (a
 * K/A/U/L/D activity_log row within the D30 7-day window, whose undo
 * has not been reverted) leaves the queue — and ONLY then. That
 * exclusion is what makes "row leaves the queue on server
 * confirmation" true end-to-end: the FE refetches after the worker /
 * intent endpoint commits, and the refetch drops the row.
 *
 * Both sides of the correlated NOT EXISTS are seeded with ≥2 rows
 * (two senders, two decisions, activity rows across mailboxes) so a
 * silently-degenerate correlation (the Drizzle bare-column pitfall)
 * fails these assertions instead of passing vacuously.
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

const SENDER_A = 'a'.repeat(64);
const SENDER_B = 'b'.repeat(64);

async function freshDb(): Promise<Db> {
  const pg = new PGlite({ extensions: { citext } });
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) await pg.query(trimmed);
    }
  }
  return drizzle(pg, { schema });
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

async function seedSenderWithDecision(
  db: Db,
  mailboxAccountId: string,
  senderKey: string,
  email: string,
): Promise<void> {
  await db.insert(senders).values({
    mailboxAccountId,
    senderKey,
    email,
    domain: email.split('@')[1]!,
    gmailCategory: 'promotions',
    firstSeenAt: new Date('2026-01-01'),
    lastSeenAt: new Date('2026-06-01'),
  });
  await db.insert(triageDecisions).values({
    mailboxAccountId,
    senderKey,
    verdict: 'archive',
    confidence: '0.90',
    reasoning: 'High volume, never read.',
    generatedBy: 'template',
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
  });
}

/** A Date N days before now. */
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

describe('TriageReadService.listQueue — decided-sender exclusion (D30/D226)', () => {
  let db: Db;
  let mailboxId: string;
  let svc: TriageReadService;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db, 'one');
    await seedSenderWithDecision(db, mailboxId, SENDER_A, 'a@shop.example');
    await seedSenderWithDecision(db, mailboxId, SENDER_B, 'b@news.example');
    svc = new TriageReadService(db as never);
  });

  it('a protected sender recommends Keep, never the raw engine verdict (2026-07-10 contradiction fix)', async () => {
    // SENDER_A has an archive/0.90 decision from the seed. Protect it:
    // the row must now recommend Keep, keep the protection reason, and
    // explain the override in the reasoning — while the underlying
    // triage_decisions row stays untouched (display-layer only).
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_A,
      isProtected: true,
      protectionReason: 'engagement_based',
      protectionSetAt: new Date(),
    });

    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 });
    const protectedRow = rows.find((r) => r.senderKey === SENDER_A)!;
    expect(protectedRow.verdict).toBe('keep');
    expect(protectedRow.protectionReason).toBe('engagement');
    expect(protectedRow.reasoning).toContain('protected (engagement)');
    expect(protectedRow.reasoning).toContain('the engine would suggest: archive');

    // The stored engine verdict is NOT rewritten.
    const [stored] = await db
      .select({ verdict: triageDecisions.verdict })
      .from(triageDecisions)
      .where(eq(triageDecisions.senderKey, SENDER_A));
    expect(stored!.verdict).toBe('archive');

    // Unprotected sibling keeps its raw verdict.
    expect(rows.find((r) => r.senderKey === SENDER_B)!.verdict).toBe('archive');
  });

  it('a DEMOTED sender (memory pin: is_protected=false, reason retained) is NOT shown protected and keeps its raw verdict', async () => {
    // The user-agency-wins state from sender-policies.ts: manual demote
    // clears is_protected but keeps protection_reason so sync skips
    // re-protect. Reading the raw reason without the flag showed these
    // as protected — and would force Keep onto a sender the user
    // explicitly demoted.
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_A,
      isProtected: false,
      protectionReason: 'engagement_based',
    });

    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 });
    const demoted = rows.find((r) => r.senderKey === SENDER_A)!;
    expect(demoted.protectionReason).toBeNull();
    expect(demoted.verdict).toBe('archive');
    expect(demoted.reasoning).toBe('High volume, never read.');
  });

  it('returns every engine decision (with senderId) when nothing is decided', async () => {
    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 });
    expect(rows.map((r) => r.senderKey).sort()).toEqual([SENDER_A, SENDER_B]);
    // senderId is the senders.id uuid — the POST /api/actions selector.
    for (const row of rows) {
      expect(row.senderId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('excludes a sender with a fresh Keep decision row (intent endpoints)', async () => {
    await db.insert(activityLog).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_A,
      source: 'manual',
      action: 'keep',
      affectedCount: 0,
      undoToken: null,
    });
    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 });
    expect(rows.map((r) => r.senderKey)).toEqual([SENDER_B]);
  });

  it('excludes a sender with a fresh worker-confirmed Archive row (undo not reverted)', async () => {
    const [journal] = await db
      .insert(undoJournal)
      .values({ mailboxAccountId: mailboxId, actionKind: 'archive', payload: { messageIds: [] } })
      .returning({ token: undoJournal.token });
    await db.insert(activityLog).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_B,
      source: 'manual',
      action: 'archive',
      affectedCount: 3,
      undoToken: journal!.token,
    });
    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 });
    expect(rows.map((r) => r.senderKey)).toEqual([SENDER_A]);
  });

  it('returns the sender to the queue once its undo is reverted (changed mind)', async () => {
    const [journal] = await db
      .insert(undoJournal)
      .values({
        mailboxAccountId: mailboxId,
        actionKind: 'archive',
        payload: { messageIds: [] },
        revertedAt: new Date(),
      })
      .returning({ token: undoJournal.token });
    await db.insert(activityLog).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_B,
      source: 'manual',
      action: 'archive',
      affectedCount: 3,
      undoToken: journal!.token,
    });
    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 });
    expect(rows.map((r) => r.senderKey).sort()).toEqual([SENDER_A, SENDER_B]);
  });

  it('a decision older than the 7-day window no longer excludes (D30 re-surface)', async () => {
    await db.insert(activityLog).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_A,
      source: 'manual',
      action: 'keep',
      affectedCount: 0,
      undoToken: null,
      occurredAt: daysAgo(8),
    });
    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 });
    expect(rows.map((r) => r.senderKey).sort()).toEqual([SENDER_A, SENDER_B]);
  });

  it("another mailbox's decisions never leak into this queue's exclusion", async () => {
    const otherMailbox = await seedMailbox(db, 'two');
    await seedSenderWithDecision(db, otherMailbox, SENDER_A, 'a@shop.example');
    // The OTHER mailbox decided on the same sender_key.
    await db.insert(activityLog).values({
      mailboxAccountId: otherMailbox,
      senderKey: SENDER_A,
      source: 'manual',
      action: 'keep',
      affectedCount: 0,
      undoToken: null,
    });
    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 });
    expect(rows.map((r) => r.senderKey).sort()).toEqual([SENDER_A, SENDER_B]);
  });

  it('a non-K/A/U/L/D bookkeeping action (followup-dismiss) does not exclude', async () => {
    await db.insert(activityLog).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_A,
      source: 'manual',
      action: 'followup-dismiss',
      affectedCount: 0,
      undoToken: null,
    });
    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 });
    expect(rows.map((r) => r.senderKey).sort()).toEqual([SENDER_A, SENDER_B]);
  });
});

/** Seed one inbound message for the sender at the given age (days). */
async function seedMessage(
  db: Db,
  mailboxAccountId: string,
  senderKey: string,
  ageDays: number,
  overrides: { isOutbound?: boolean } = {},
): Promise<void> {
  await db.insert(mailMessages).values({
    mailboxAccountId,
    providerMessageId: `msg-${senderKey.slice(0, 6)}-${ageDays}-${Math.random().toString(36).slice(2, 8)}`,
    providerThreadId: `thr-${senderKey.slice(0, 6)}`,
    senderKey,
    internalDate: daysAgo(ageDays),
    isUnread: true,
    isOutbound: overrides.isOutbound ?? false,
  });
}

describe('TriageReadService.getTodaySummary — the D214 Today strip', () => {
  let db: Db;
  let mailboxId: string;
  let svc: TriageReadService;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db, 'today');
    svc = new TriageReadService(db as never);
  });

  it('returns all-zero on a fresh mailbox (queue empty → pct null)', async () => {
    const summary = await svc.getTodaySummary({ mailboxAccountId: mailboxId });
    expect(summary).toEqual({
      receivedToday: 0,
      sendersToday: 0,
      handledAutomatically: 0,
      queuedDecisions: 0,
      noiseReductionPct: null,
    });
  });

  it('counts today-received inbound mail + distinct senders, excluding outbound and older mail', async () => {
    await seedSenderWithDecision(db, mailboxId, SENDER_A, 'a@shop.example');
    await seedSenderWithDecision(db, mailboxId, SENDER_B, 'b@news.example');
    // Three inbound today across two senders + one outbound today +
    // one inbound yesterday — only the three count.
    await seedMessage(db, mailboxId, SENDER_A, 0);
    await seedMessage(db, mailboxId, SENDER_A, 0);
    await seedMessage(db, mailboxId, SENDER_B, 0);
    await seedMessage(db, mailboxId, SENDER_A, 0, { isOutbound: true });
    await seedMessage(db, mailboxId, SENDER_B, 2);

    const summary = await svc.getTodaySummary({ mailboxAccountId: mailboxId });
    expect(summary.receivedToday).toBe(3);
    expect(summary.sendersToday).toBe(2);
  });

  it("sums Autopilot's affected_count today; manual rows and older autopilot rows don't count", async () => {
    await db.insert(activityLog).values([
      // Autopilot today — two rule fires moving 5 + 3 messages.
      {
        mailboxAccountId: mailboxId,
        senderKey: SENDER_A,
        source: 'autopilot' as const,
        action: 'archive' as const,
        affectedCount: 5,
      },
      {
        mailboxAccountId: mailboxId,
        senderKey: SENDER_B,
        source: 'autopilot' as const,
        action: 'archive' as const,
        affectedCount: 3,
      },
      // Manual archive today — not "handled automatically".
      {
        mailboxAccountId: mailboxId,
        senderKey: SENDER_A,
        source: 'manual' as const,
        action: 'archive' as const,
        affectedCount: 7,
      },
      // Autopilot, but days ago.
      {
        mailboxAccountId: mailboxId,
        senderKey: SENDER_B,
        source: 'autopilot' as const,
        action: 'archive' as const,
        affectedCount: 9,
        occurredAt: daysAgo(3),
      },
    ]);
    const summary = await svc.getTodaySummary({ mailboxAccountId: mailboxId });
    expect(summary.handledAutomatically).toBe(8);
  });

  it('queuedDecisions matches the D30-clamped queue and pct is the queued non-Keep share of 90d volume', async () => {
    // Two queued archive decisions (seedSenderWithDecision verdicts
    // are 'archive'), 6 of the mailbox's 8 inbound 90d messages come
    // from them → 75%.
    await seedSenderWithDecision(db, mailboxId, SENDER_A, 'a@shop.example');
    await seedSenderWithDecision(db, mailboxId, SENDER_B, 'b@news.example');
    const quietKey = 'c'.repeat(64);
    await db.insert(senders).values({
      mailboxAccountId: mailboxId,
      senderKey: quietKey,
      email: 'c@quiet.example',
      domain: 'quiet.example',
      gmailCategory: 'primary',
      firstSeenAt: new Date('2026-01-01'),
      lastSeenAt: new Date('2026-06-01'),
    });
    for (let i = 0; i < 4; i++) await seedMessage(db, mailboxId, SENDER_A, 5);
    for (let i = 0; i < 2; i++) await seedMessage(db, mailboxId, SENDER_B, 10);
    for (let i = 0; i < 2; i++) await seedMessage(db, mailboxId, quietKey, 20);

    const summary = await svc.getTodaySummary({ mailboxAccountId: mailboxId });
    expect(summary.queuedDecisions).toBe(2);
    expect(summary.noiseReductionPct).toBe(75);
  });

  it('a decided sender leaves both the decision count and the noise share (D30 exclusion parity)', async () => {
    await seedSenderWithDecision(db, mailboxId, SENDER_A, 'a@shop.example');
    await seedSenderWithDecision(db, mailboxId, SENDER_B, 'b@news.example');
    for (let i = 0; i < 4; i++) await seedMessage(db, mailboxId, SENDER_A, 5);
    for (let i = 0; i < 4; i++) await seedMessage(db, mailboxId, SENDER_B, 5);
    // The user decided SENDER_A within the window.
    await db.insert(activityLog).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_A,
      source: 'manual',
      action: 'archive',
      affectedCount: 4,
    });
    const summary = await svc.getTodaySummary({ mailboxAccountId: mailboxId });
    expect(summary.queuedDecisions).toBe(1);
    // SENDER_B's 4 of 8 messages → 50%.
    expect(summary.noiseReductionPct).toBe(50);
  });
});
