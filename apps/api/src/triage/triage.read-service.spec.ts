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
import { freshTestDb } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TriageReadService, noiseSharePct } from './triage.read-service.js';

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
      protectionReason: 'user_defined',
      protectionSetAt: new Date(),
    });

    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 });
    const protectedRow = rows.find((r) => r.senderKey === SENDER_A)!;
    expect(protectedRow.verdict).toBe('keep');
    expect(protectedRow.protectionReason).toBe('manual');
    expect(protectedRow.reasoning).toContain('protected (manual)');
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
      protectionReason: 'replied',
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

describe('TriageReadService.listQueue — the daily ORDER BY is a total order', () => {
  let db: Db;
  let mailboxId: string;
  let svc: TriageReadService;

  // Keys chosen so sorted order is the REVERSE of insertion order. Without a
  // tiebreak the rows come back in physical/insertion order, so this fixture
  // makes the two orders disagree — a fixture that inserted in sorted order
  // would pass with or without the fix and prove nothing.
  const TIED = ['c', 'b', 'a'].map((ch) => ch.repeat(64));

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db, 'tied');
    for (const key of TIED) {
      // Identical verdict AND confidence: everything ahead of the tiebreak in
      // the ORDER BY is equal, so only the tiebreak can decide the order.
      await seedSenderWithDecision(db, mailboxId, key, `${key.slice(0, 6)}@tied.example`);
    }
    svc = new TriageReadService(db as never);
  });

  it('breaks confidence ties deterministically instead of by physical row order', async () => {
    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.senderKey)).toEqual([...TIED].sort());
  });

  it('returns the same order across reads with an unrelated write in between', async () => {
    // The user-visible failure: expanding a row rewrites `triage_decisions`,
    // and with a non-total ORDER BY that write reshuffled the visible queue —
    // cards moved, or fell out of the LIMIT entirely, mid-decision.
    //
    // HONEST LABEL: this one does NOT go red against the pre-fix code. PGlite
    // returned a stable order here anyway, so it documents the scenario rather
    // than guarding it. The test above is the one with teeth — it fails without
    // the tiebreak. Kept because a future ordering change could break this in a
    // way PGlite does expose; do not mistake it for the protection.
    const before = (await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 })).map(
      (r) => r.senderKey,
    );

    await db
      .update(triageDecisions)
      .set({ reasoning: 'rescored by an unrelated write' })
      .where(eq(triageDecisions.senderKey, TIED[0]!));

    const after = (await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 })).map(
      (r) => r.senderKey,
    );
    expect(after).toEqual(before);
  });
});

describe('TriageReadService.getTodaySummary — the D214 Today strip', () => {
  let db: Db;
  let mailboxId: string;
  let svc: TriageReadService;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db, 'today');
    svc = new TriageReadService(db as never);
  });

  it('counts only the senders the noise percentage is computed from', async () => {
    // The percentage's numerator excludes Keep rows; `queuedDecisions` counts
    // them. Copy that credits the share to all `queuedDecisions` is therefore
    // false whenever a Keep row is queued — which stayed invisible on a mailbox
    // where every queued row happened to be an unsubscribe. `noiseSenderCount`
    // exists so the FE can name the set the percentage actually describes, and
    // this pins the two to the same filter rather than to two matching
    // hand-written queries.
    const keepKey = 'k'.repeat(64);
    const dropKey = 'd'.repeat(64);
    for (const [key, verdict] of [
      [keepKey, 'keep'],
      [dropKey, 'unsubscribe'],
    ] as const) {
      await db.insert(senders).values({
        mailboxAccountId: mailboxId,
        senderKey: key,
        email: `${key.slice(0, 5)}@mixed.example`,
        domain: 'mixed.example',
        gmailCategory: 'promotions',
        firstSeenAt: daysAgo(60),
        lastSeenAt: daysAgo(1),
      });
      await db.insert(triageDecisions).values({
        mailboxAccountId: mailboxId,
        senderKey: key,
        verdict,
        confidence: '0.90',
        reasoning: 'seeded',
        generatedBy: 'template',
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      });
      await db.insert(mailMessages).values({
        mailboxAccountId: mailboxId,
        senderKey: key,
        providerMessageId: `m-${key.slice(0, 8)}`,
        providerThreadId: `t-${key.slice(0, 8)}`,
        subject: 'seeded',
        internalDate: daysAgo(5),
        isUnread: true,
        isOutbound: false,
        labelIds: ['INBOX'],
      });
    }

    const summary = await svc.getTodaySummary({ mailboxAccountId: mailboxId });
    expect(summary.queuedDecisions).toBe(2);
    // The Keep row is counted as a decision but contributes no noise.
    expect(summary.noiseSenderCount).toBe(1);
    expect(summary.noiseSenderCount).toBeLessThan(summary.queuedDecisions);
  });

  it('returns all-zero on a fresh mailbox (queue empty → pct null)', async () => {
    const summary = await svc.getTodaySummary({ mailboxAccountId: mailboxId });
    expect(summary).toEqual({
      receivedToday: 0,
      sendersToday: 0,
      handledAutomatically: 0,
      queuedDecisions: 0,
      noiseSenderCount: 0,
      noiseReductionPct: null,
    });
  });

  it('builds the route bootstrap while executing the queue read only once', async () => {
    await seedSenderWithDecision(db, mailboxId, SENDER_A, 'a@shop.example');
    await seedMessage(db, mailboxId, SENDER_A, 0);
    const queueSpy = vi.spyOn(svc, 'listQueue');

    const bootstrap = await svc.getBootstrap({ mailboxAccountId: mailboxId, limit: 12 });

    expect(queueSpy).toHaveBeenCalledTimes(1);
    expect(bootstrap.queue).toHaveLength(1);
    expect(bootstrap.todaySummary.queuedDecisions).toBe(1);
    expect(bootstrap.stats).toMatchObject({ tier: 'free' });
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

  it('divides by the SAME 90-day window the numerator counted', async () => {
    // The original defect: the numerator cut at `Date.now() - 90d` (rolling)
    // while the denominator cut at `todayStartUtc - 90d` (UTC midnight). The
    // denominator's window was therefore up to a day WIDER, so the share was a
    // ratio between two different spans and read low — worst just before
    // midnight UTC, which is what this fixture pins.
    //
    // The window stays ROLLING, matching every other 90-day read in the
    // product; what changed is that both halves take the same instant.
    const now = new Date(Date.UTC(2026, 4, 20, 23, 0, 0));
    const at = (msBefore: number): Date => new Date(now.getTime() - msBefore);

    await seedSenderWithDecision(db, mailboxId, SENDER_A, 'a@shop.example');
    await seedSenderWithDecision(db, mailboxId, SENDER_B, 'b@news.example');
    const quietKey = 'c'.repeat(64);
    const stragglerKey = 'e'.repeat(64);
    for (const [key, email] of [
      [quietKey, 'c@quiet.example'],
      [stragglerKey, 'e@old.example'],
    ] as const) {
      await db.insert(senders).values({
        mailboxAccountId: mailboxId,
        senderKey: key,
        email,
        domain: email.split('@')[1]!,
        gmailCategory: 'primary',
        firstSeenAt: new Date('2026-01-01'),
        lastSeenAt: new Date('2026-06-01'),
      });
    }
    const seedAt = async (key: string, when: Date): Promise<void> => {
      await db.insert(mailMessages).values({
        mailboxAccountId: mailboxId,
        senderKey: key,
        providerMessageId: `w-${key.slice(0, 6)}-${when.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        providerThreadId: `wt-${key.slice(0, 6)}`,
        internalDate: when,
        isUnread: true,
        isOutbound: false,
      });
    };
    // 6 queued of 8 in-window inbound → 75%.
    for (let i = 0; i < 4; i++) await seedAt(SENDER_A, at(5 * 86_400_000));
    for (let i = 0; i < 2; i++) await seedAt(SENDER_B, at(10 * 86_400_000));
    for (let i = 0; i < 2; i++) await seedAt(quietKey, at(20 * 86_400_000));
    // 90 days and 12 hours old: outside the rolling window BOTH halves now
    // use, but inside the midnight-anchored one the denominator used to take.
    // It is the only row the two cutoffs ever disagreed about.
    await seedAt(stragglerKey, at(90 * 86_400_000 + 12 * 3_600_000));

    const summary = await svc.getTodaySummary({ mailboxAccountId: mailboxId, now });
    expect(summary.queuedDecisions).toBe(2);
    // 6/8. Counting the straggler in the denominator alone gave 6/9 → 67%.
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

describe('noiseSharePct — the share refuses to guess', () => {
  it('reports the share when the two reads agree', () => {
    expect(noiseSharePct(6, 8)).toBe(75);
  });

  it('makes no claim when the queued subset exceeds the mailbox total', () => {
    // Only reachable when the numerator and denominator — separate statements
    // with no transaction around them — describe different snapshots, e.g. a
    // sync reclassifying mail as outbound between the two reads. `Math.min`
    // rendered this as exactly "100%": the most confident claim available,
    // from evidence the inputs disagreed.
    expect(noiseSharePct(12, 10)).toBeNull();
  });

  it('makes no claim when there is nothing to divide by', () => {
    expect(noiseSharePct(3, 0)).toBeNull();
  });
});

describe('TriageReadService.listQueue — "last seen" is when the SENDER wrote', () => {
  let db: Db;
  let mailboxId: string;
  let svc: TriageReadService;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db, 'lastseen');
    svc = new TriageReadService(db as never);
  });

  it('ignores outbound mail when picking the last-seen date', async () => {
    // Mail the user SENT is stored under the hash of its own `From`, so a
    // message to your own address or a sending alias shares the sender key.
    // `last90dMessages` filtered those out; the sibling `MAX(internal_date)`
    // in the same SELECT did not — so sending today made a sender whose newest
    // inbound message was 45 days old render "LAST SEEN today".
    await seedSenderWithDecision(db, mailboxId, SENDER_A, 'me@declutrmail.ai');
    await seedMessage(db, mailboxId, SENDER_A, 45);
    await seedMessage(db, mailboxId, SENDER_A, 0, { isOutbound: true });

    const [row] = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 });
    // The 45-day-old INBOUND message, not today's outbound one. The wire
    // carries the instant; the browser turns it into a day count, so this
    // asserts the date itself rather than a rounded difference.
    const seen =
      row?.lastSeenAt === undefined || row.lastSeenAt === null ? null : new Date(row.lastSeenAt);
    expect(seen).not.toBeNull();
    const ageDays = Math.round((Date.now() - seen!.getTime()) / 86_400_000);
    expect(ageDays).toBe(45);
  });
});

describe('TriageReadService.listQueue — signals say "marked read", not "read rate" (QA-triage-20260827-07)', () => {
  let db: Db;
  let mailboxId: string;
  let svc: TriageReadService;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db, 'signals-wording');
    svc = new TriageReadService(db as never);
  });

  it('names the engagement signal "Marked read", matching the collapsed row\'s wording', async () => {
    await seedSenderWithDecision(db, mailboxId, SENDER_A, 'signals@declutrmail.ai');
    await seedMessage(db, mailboxId, SENDER_A, 10);

    const [row] = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 });
    const engagementSignal = row?.signals.find(
      (s) => s.startsWith('Marked read') || s.startsWith('Read rate'),
    );
    expect(engagementSignal).toMatch(/^Marked read: /);
  });
});

describe('TriageReadService.listQueue — the senderKeys narrowing filter', () => {
  let db: Db;
  let mailboxId: string;
  let svc: TriageReadService;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db, 'keys');
    await seedSenderWithDecision(db, mailboxId, SENDER_A, 'a@shop.example');
    await seedSenderWithDecision(db, mailboxId, SENDER_B, 'b@news.example');
    svc = new TriageReadService(db as never);
  });

  it('returns only the named senders', async () => {
    const rows = await svc.listQueue({
      mailboxAccountId: mailboxId,
      limit: 12,
      senderKeys: [SENDER_A],
    });
    expect(rows.map((r) => r.senderKey)).toEqual([SENDER_A]);
  });

  it('returns NOTHING for an empty key list — never the whole mailbox', async () => {
    // The blind case, starved on purpose: a read asked for zero senders
    // must answer with zero, not with the whole mailbox (the "narrowed
    // query silently returns everything" trap). Verified 2026-08-10
    // that this stays green even with the service's early return
    // deleted — drizzle's `inArray(col, [])` emits `WHERE false` on its
    // own — so this pins the CONTRACT across both defenses; the
    // explicit guard remains as the driver-independent one.
    const rows = await svc.listQueue({
      mailboxAccountId: mailboxId,
      limit: 12,
      senderKeys: [],
    });
    expect(rows).toEqual([]);
  });
});

describe('TriageReadService.readProtectionReview — the counts share one taxonomy', () => {
  let db: Db;
  let mailboxId: string;
  let svc: TriageReadService;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db, 'buckets');
    svc = new TriageReadService(db as never);
  });

  async function protect(
    senderKey: string,
    email: string,
    reason: 'user_defined' | 'replied' | 'starred' | 'gmail_important',
  ) {
    await seedSenderWithDecision(db, mailboxId, senderKey, email);
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey,
      isProtected: true,
      protectionReason: reason,
      protectionSetAt: new Date(),
    });
  }

  it('buckets every protected sender and the buckets sum to the protected total', async () => {
    // The counts used to be three SQL FILTER literals — a second copy of
    // the taxonomy `@declutrmail/shared/copy` owns. They now bucket
    // through the shared normalize/isWeak, so a reason can land in
    // exactly one bucket and strong+weak+manual must equal COUNT(*)
    // WHERE is_protected. A fifth enum value would break this sum (it
    // is logged and excluded, never guessed into a bucket) — which is
    // the loud failure #485's silent one argues for.
    await protect('sk_replied', 'r@x.example', 'replied');
    await protect('sk_star', 's@x.example', 'starred');
    await protect('sk_imp', 'i@x.example', 'gmail_important');
    await protect('sk_manual', 'm@x.example', 'user_defined');
    // A demoted row must count in NO bucket.
    await seedSenderWithDecision(db, mailboxId, 'sk_demoted', 'd@x.example');
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: 'sk_demoted',
      isProtected: false,
      protectionReason: 'replied',
    });

    const review = await svc.readProtectionReview({ mailboxAccountId: mailboxId, limit: 50 });

    expect(review.strong).toBe(1);
    expect(review.weak).toBe(2);
    expect(review.manual).toBe(1);
    expect(review.strong + review.weak + review.manual).toBe(4);
    // The rows are exactly the weak keys.
    expect([...review.senderKeys].sort()).toEqual(['sk_imp', 'sk_star']);
  });
});

describe('TriageReadService.listQueue — the age of the engine read (D25)', () => {
  let db: Db;
  let mailboxId: string;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db, 'age');
  });

  /**
   * `verdict` / `confidence` / `reasoning` are STORED at score time;
   * every statistic on the same row is recomputed per request. Nothing
   * in production re-scores an existing sender, so a queue row's
   * sentence can be weeks older than the numbers printed beside it —
   * the founder's 2026-08-19 report was a card reading "60 messages
   * monthly, 1% read rate" above a live "0% read in 90d · 209 messages".
   *
   * The row has to carry its own age for the FE to reconcile the two,
   * and `stale` has to be the SERVER's verdict on the TTL so Triage,
   * the Screener and Sender Detail cannot disagree about the word.
   *
   * Both rows are seeded so the assertion discriminates: an
   * implementation that hard-codes either value fails one of them.
   */
  it('reports each row scored-at and whether it is past its TTL', async () => {
    const scoredAt = daysAgo(20);
    await seedSenderWithDecision(db, mailboxId, SENDER_A, 'stale@ex.com');
    await seedSenderWithDecision(db, mailboxId, SENDER_B, 'fresh@ex.com');
    // A expired 13 days ago; B is still inside its window.
    await db
      .update(triageDecisions)
      .set({ producedAt: scoredAt, expiresAt: daysAgo(13) })
      .where(eq(triageDecisions.senderKey, SENDER_A));

    const rows = await new TriageReadService(db as never).listQueue({
      mailboxAccountId: mailboxId,
      limit: 10,
    });
    const byKey = new Map(rows.map((r) => [r.senderKey, r]));

    expect(byKey.get(SENDER_A)?.stale).toBe(true);
    expect(byKey.get(SENDER_A)?.scoredAt).toBe(scoredAt.toISOString());
    expect(byKey.get(SENDER_B)?.stale).toBe(false);
  });

  /**
   * An expired read must still be SERVED. Hiding it would empty the
   * queue for any mailbox that hasn't been re-scored — which, with no
   * cron producer, is every mailbox past its first week. A visibly old
   * recommendation is honest; an absent one is a broken screen.
   */
  it('still serves a row whose read has expired', async () => {
    await seedSenderWithDecision(db, mailboxId, SENDER_A, 'stale@ex.com');
    await db
      .update(triageDecisions)
      .set({ producedAt: daysAgo(60), expiresAt: daysAgo(53) })
      .where(eq(triageDecisions.senderKey, SENDER_A));

    const rows = await new TriageReadService(db as never).listQueue({
      mailboxAccountId: mailboxId,
      limit: 10,
    });
    expect(rows.map((r) => r.senderKey)).toContain(SENDER_A);
  });
});
