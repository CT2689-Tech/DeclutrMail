import { createHash, randomUUID } from 'node:crypto';

import {
  mailboxAccounts,
  schema,
  senders,
  triageDecisions,
  users,
  workspaces,
  type TriageVerdict,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { EXPLAIN_BATCH_MAX } from '@declutrmail/shared/contracts';
import { FIRST_VIEW_QUEUE_ROWS, scoreJobOptions } from '@declutrmail/workers';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  TRIAGE_QUEUE_MAX,
  TRIAGE_QUEUE_MIN,
  TriageService,
  computeQueueSize,
} from './triage.service.js';

/**
 * TriageService tests — focused on D30 adaptive queue size.
 *
 * Two layers, mirroring `senders.read-service.spec.ts`:
 *
 *   1. Pure-function tests on `computeQueueSize` cover the algorithm's
 *      boundaries without spinning up a database — the math the FE
 *      relies on is locked in by a tight, fast suite.
 *
 *   2. Integration tests against PGlite + the real `triage_decisions`
 *      table cover the SELECT — non-Keep verdicts, stale `produced_at`,
 *      tenant isolation.
 *
 * Per D204 the service is read-only over the decision table; this spec
 * never writes from inside the service. The seed code that writes
 * `triage_decisions` mimics what the score-worker would have written.
 */

type Db = ReturnType<typeof drizzle<typeof schema>>;

async function freshDb(): Promise<Db> {
  return freshTestDb();
}

async function seedMailbox(db: Db, email: string): Promise<string> {
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
  return mb!.id;
}

function senderKeyFor(email: string): string {
  return createHash('sha256').update(`v1|${email.toLowerCase()}`).digest('hex');
}

/**
 * Insert one decision row directly — mimics the score-worker's upsert.
 * `daysOld` controls `produced_at` so the spec can stage rows on either
 * side of the 7-day "stale" boundary.
 */
async function seedDecision(
  db: Db,
  args: {
    mailboxAccountId: string;
    verdict: TriageVerdict;
    daysOld: number;
    senderEmail?: string;
  },
): Promise<void> {
  const producedAt = new Date(Date.now() - args.daysOld * 24 * 60 * 60 * 1000);
  const expiresAt = new Date(producedAt.getTime() + 14 * 24 * 60 * 60 * 1000);
  await db.insert(triageDecisions).values({
    mailboxAccountId: args.mailboxAccountId,
    senderKey: senderKeyFor(args.senderEmail ?? `${randomUUID()}@example.com`),
    verdict: args.verdict,
    confidence: '0.90',
    reasoning: 'test fixture',
    generatedBy: 'template',
    producedAt,
    expiresAt,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Pure-function tests — D30 algorithm boundaries
// ──────────────────────────────────────────────────────────────────────

describe('computeQueueSize — D30 adaptive sizing (pure)', () => {
  it('exports MIN=5 and MAX=12 — D30 ceiling/floor', () => {
    expect(TRIAGE_QUEUE_MIN).toBe(5);
    expect(TRIAGE_QUEUE_MAX).toBe(12);
  });

  describe('low inbox activity → floor at 5', () => {
    it.each([
      [0, 5],
      [1, 5],
      [5, 5],
      [10, 5],
      [12, 5], // ceil(12 × 0.4) = ceil(4.8) = 5 → still floor
    ])('backlog=%i → queue size %i', (backlog, expected) => {
      expect(computeQueueSize(backlog)).toBe(expected);
    });
  });

  describe('medium inbox activity → ceil(backlog × 0.4)', () => {
    it.each([
      [13, 6], // ceil(5.2) = 6 — first row above floor
      [15, 6],
      [20, 8], // ceil(8.0) = 8
      [22, 9], // ceil(8.8) = 9
      [25, 10], // ceil(10) = 10
    ])('backlog=%i → queue size %i', (backlog, expected) => {
      expect(computeQueueSize(backlog)).toBe(expected);
    });
  });

  describe('high inbox activity → ceiling at 12', () => {
    it.each([
      [29, 12], // ceil(11.6) = 12 — just hits ceiling
      [30, 12],
      [50, 12],
      [200, 12],
      [10_000, 12], // pathological — still clamped
    ])('backlog=%i → queue size %i', (backlog, expected) => {
      expect(computeQueueSize(backlog)).toBe(expected);
    });
  });

  describe('defensive coercion', () => {
    it('treats negative backlog as 0 → floor', () => {
      expect(computeQueueSize(-1)).toBe(5);
      expect(computeQueueSize(-100)).toBe(5);
    });

    it('treats NaN / Infinity as 0 → floor', () => {
      expect(computeQueueSize(Number.NaN)).toBe(5);
      expect(computeQueueSize(Number.POSITIVE_INFINITY)).toBe(5);
      expect(computeQueueSize(Number.NEGATIVE_INFINITY)).toBe(5);
    });
  });

  describe('D30 worked example — 50-sender backlog clears in ~5 days', () => {
    it('drawdown converges to the floor without dumping the whole backlog at once', () => {
      // The D30 doc says: "a user with 50-sender backlog clears it in
      // ~5 days, not all at once." The exact drawdown given MIN=5,
      // MAX=12, factor=0.4 is:
      //   day 1: backlog 50 → ceil(20)=20 clamped to 12; remaining 38
      //   day 2: backlog 38 → ceil(15.2)=16 clamped to 12; remaining 26
      //   day 3: backlog 26 → ceil(10.4)=11; remaining 15
      //   day 4: backlog 15 → ceil(6.0)=6; remaining 9
      //   day 5: backlog 9  → ceil(3.6)=4 floored to 5; remaining 4
      //   day 6: backlog 4  → floor = 5; remaining 0
      const sessions: number[] = [];
      let backlog = 50;
      for (let i = 0; i < 6; i += 1) {
        const size = computeQueueSize(backlog);
        sessions.push(size);
        backlog = Math.max(0, backlog - size);
      }
      expect(sessions).toEqual([12, 12, 11, 6, 5, 5]);
      // First two days hit the ceiling — confirming D30's burst-cap.
      expect(sessions[0]).toBe(TRIAGE_QUEUE_MAX);
      expect(sessions[1]).toBe(TRIAGE_QUEUE_MAX);
      // The tail returns to the floor — confirming D30's "preserves
      // daily-ritual feel" clause.
      expect(sessions[sessions.length - 1]).toBe(TRIAGE_QUEUE_MIN);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Integration tests — service + PGlite + real schema
// ──────────────────────────────────────────────────────────────────────

describe('TriageService.scoreSender — trigger provenance (D25)', () => {
  let db: Db;
  let added: Array<{ payload: Record<string, unknown>; opts: Record<string, unknown> }>;
  let service: TriageService;
  let mailboxA: string;

  beforeEach(async () => {
    db = await freshDb();
    added = [];
    const spyQueue = {
      add: async (
        _name: string,
        payload: Record<string, unknown>,
        opts: Record<string, unknown>,
      ) => {
        added.push({ payload, opts });
      },
    } as never;
    service = new TriageService(db as never, spyQueue);
    mailboxA = await seedMailbox(db, 'a@example.com');
  });

  /**
   * A page refreshing a read that aged out is not the user pressing a
   * button. Recording both as `manual_rescore` would make the trigger
   * telemetry claim an intent nobody had — the same class of untruth as
   * a suggestion rendered as a decision.
   */
  it('records an opened-page refresh as stale_refresh, not manual_rescore', async () => {
    await service.scoreSender({
      mailboxAccountId: mailboxA,
      senderKey: 'key-1',
      reason: 'stale',
      producedAtMs: 1_000,
    });
    expect(added[0]?.payload).toMatchObject({ trigger: 'stale_refresh' });
  });

  it('still records a user-pressed re-score as manual_rescore', async () => {
    await service.scoreSender({
      mailboxAccountId: mailboxA,
      senderKey: 'key-1',
      reason: 'user',
      producedAtMs: 1_000,
    });
    expect(added[0]?.payload).toMatchObject({ trigger: 'manual_rescore' });

    await service.scoreSender({
      mailboxAccountId: mailboxA,
      senderKey: 'key-2',
      producedAtMs: 1_000,
    });
    expect(added[1]?.payload).toMatchObject({ trigger: 'manual_rescore' });
  });

  /**
   * Negative control (CLAUDE.md §8): before `scoreSender` passed
   * `scoreJobOptions(idempotencyKey)`, its third `.add()` argument was a
   * bare `{ jobId: idempotencyKey }` — no `attempts`, no `backoff`. BullMQ
   * defaults a job with no `attempts` to a single try, so a transient
   * ScoreWorker failure (a DB hiccup mid-run) dead-lettered a manual/stale
   * re-score after one attempt instead of retrying with
   * `perMailboxPolicy`'s 5-attempt backoff budget. Reverting the
   * `triage.service.ts` change back to `{ jobId: idempotencyKey }` fails
   * this assertion.
   */
  it('grants the perMailboxPolicy retry budget instead of a single try', async () => {
    const { idempotencyKey } = await service.scoreSender({
      mailboxAccountId: mailboxA,
      senderKey: 'key-1',
      reason: 'user',
      producedAtMs: 1_000,
    });
    expect(added[0]?.opts).toEqual(scoreJobOptions(idempotencyKey));
    expect(added[0]?.opts).toMatchObject({ attempts: 5, removeOnFail: false });
  });

  it('resolves a sender id only inside its own mailbox', async () => {
    const mailboxB = await seedMailbox(db, 'b@example.com');
    const [row] = await db
      .insert(senders)
      .values({
        mailboxAccountId: mailboxA,
        senderKey: 'resolvable-key',
        email: 'resolve@example.com',
        displayName: 'Resolve Me',
        domain: 'example.com',
        gmailCategory: 'promotions',
        firstSeenAt: new Date('2026-01-01T00:00:00Z'),
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      })
      .returning({ id: senders.id });

    expect(await service.resolveSenderKey(mailboxA, row!.id)).toBe('resolvable-key');
    // Same id, wrong mailbox — a guessed id must not reach another
    // tenant's sender.
    expect(await service.resolveSenderKey(mailboxB, row!.id)).toBeNull();
  });
});

describe('TriageService.getQueueSize — D30 integration', () => {
  let db: Db;
  let service: TriageService;
  let mailboxA: string;
  let mailboxB: string;

  beforeEach(async () => {
    db = await freshDb();
    // Queue dependency is not exercised in these tests; pass a stub
    // shaped like BullMQ's `Queue` so the constructor is happy.
    const stubQueue = { add: async () => undefined } as never;
    service = new TriageService(db as never, stubQueue);
    mailboxA = await seedMailbox(db, 'a@example.com');
    mailboxB = await seedMailbox(db, 'b@example.com');
  });

  it('returns the floor (5) when there are no decisions', async () => {
    const size = await service.getQueueSize(mailboxA);
    expect(size).toBe(TRIAGE_QUEUE_MIN);
  });

  it('excludes Keep verdicts from the backlog', async () => {
    // 12 Keep rows would otherwise push us toward the floor cusp; the
    // floor-vs-step assertion would still hit 5, but the goal here is
    // to verify Keep rows are filtered out entirely.
    for (let i = 0; i < 20; i += 1) {
      await seedDecision(db, {
        mailboxAccountId: mailboxA,
        verdict: 'keep',
        daysOld: 10,
        senderEmail: `keep-${i}@example.com`,
      });
    }
    expect(await service.getQueueSize(mailboxA)).toBe(TRIAGE_QUEUE_MIN);
  });

  it('excludes rows produced within the last 7 days (still "fresh")', async () => {
    // Recent rows — should NOT count toward the backlog.
    for (let i = 0; i < 30; i += 1) {
      await seedDecision(db, {
        mailboxAccountId: mailboxA,
        verdict: 'archive',
        daysOld: 1,
        senderEmail: `fresh-${i}@example.com`,
      });
    }
    expect(await service.getQueueSize(mailboxA)).toBe(TRIAGE_QUEUE_MIN);
  });

  it('counts stale non-Keep verdicts and adapts the queue size', async () => {
    // 20 stale Archives + 5 stale Unsubscribes = backlog 25.
    // ceil(25 × 0.4) = 10 → queue size 10.
    for (let i = 0; i < 20; i += 1) {
      await seedDecision(db, {
        mailboxAccountId: mailboxA,
        verdict: 'archive',
        daysOld: 14,
        senderEmail: `stale-archive-${i}@example.com`,
      });
    }
    for (let i = 0; i < 5; i += 1) {
      await seedDecision(db, {
        mailboxAccountId: mailboxA,
        verdict: 'unsubscribe',
        daysOld: 14,
        senderEmail: `stale-unsub-${i}@example.com`,
      });
    }
    expect(await service.getQueueSize(mailboxA)).toBe(10);
  });

  it('clamps to the ceiling on heavy backlog', async () => {
    for (let i = 0; i < 80; i += 1) {
      await seedDecision(db, {
        mailboxAccountId: mailboxA,
        verdict: 'archive',
        daysOld: 14,
        senderEmail: `stale-${i}@example.com`,
      });
    }
    expect(await service.getQueueSize(mailboxA)).toBe(TRIAGE_QUEUE_MAX);
  });

  it('does not leak backlog across tenants', async () => {
    for (let i = 0; i < 40; i += 1) {
      await seedDecision(db, {
        mailboxAccountId: mailboxB,
        verdict: 'archive',
        daysOld: 14,
        senderEmail: `other-${i}@example.com`,
      });
    }
    expect(await service.getQueueSize(mailboxA)).toBe(TRIAGE_QUEUE_MIN);
    expect(await service.getQueueSize(mailboxB)).toBe(TRIAGE_QUEUE_MAX);
  });
});

describe('TriageService.explainSenders — explanations on demand (D24)', () => {
  let db: Db;
  let queued: Array<{ name: string; data: Record<string, unknown>; opts: Record<string, unknown> }>;
  let service: TriageService;
  let mailboxA: string;
  let mailboxB: string;

  /**
   * Models the two BullMQ 6 behaviours this producer leans on, rather than
   * accepting anything. A custom job id containing `:` is rejected unless
   * it has exactly three segments — a spy that took any id is how a
   * malformed id shipped twice before (U14, domain icons). And a job whose
   * `deduplication.id` is already live (throttle mode: the key outlives the
   * job for `ttl`) is not added again.
   */
  function bullmqLikeQueue() {
    const liveDedupIds = new Set<string>();
    return {
      addBulk: async (
        jobs: Array<{
          name: string;
          data: Record<string, unknown>;
          opts: { jobId?: string; deduplication?: { id: string; ttl?: number } };
        }>,
      ) => {
        for (const job of jobs) {
          const id = job.opts.jobId ?? '';
          if (id.includes(':') && id.split(':').length !== 3) {
            throw new Error('Custom Id cannot contain :');
          }
          const dedupId = job.opts.deduplication?.id;
          if (dedupId !== undefined) {
            if (liveDedupIds.has(dedupId)) continue;
            liveDedupIds.add(dedupId);
          }
          queued.push(job as never);
        }
      },
    } as never;
  }

  async function seedScoredSender(
    mailboxAccountId: string,
    email: string,
    decision: { generatedBy: 'llm_haiku' | 'template'; producedAt: Date; expiresAt: Date } | null,
  ): Promise<{ id: string; senderKey: string }> {
    const senderKey = senderKeyFor(email);
    const [row] = await db
      .insert(senders)
      .values({
        mailboxAccountId,
        senderKey,
        email,
        displayName: email,
        domain: 'example.com',
        gmailCategory: 'promotions',
        firstSeenAt: new Date('2026-01-01T00:00:00Z'),
        lastSeenAt: new Date('2026-05-01T00:00:00Z'),
      })
      .returning({ id: senders.id });
    if (decision) {
      await db.insert(triageDecisions).values({
        mailboxAccountId,
        senderKey,
        verdict: 'archive',
        confidence: '0.80',
        reasoning: 'Sender sends 30/mo. Recommended: Archive.',
        ...decision,
      });
    }
    return { id: row!.id, senderKey };
  }

  const FRESH = {
    producedAt: new Date('2026-09-25T08:30:00.123Z'),
    expiresAt: new Date('2026-10-02T08:30:00.123Z'),
  };

  beforeEach(async () => {
    db = await freshDb();
    queued = [];
    service = new TriageService(db as never, null, bullmqLikeQueue());
    mailboxA = await seedMailbox(db, 'a@example.com');
    mailboxB = await seedMailbox(db, 'b@example.com');
  });

  it('queues one explain job per fresh template row, keyed to the row version', async () => {
    const opened = await seedScoredSender(mailboxA, 'opened@example.com', {
      generatedBy: 'template',
      ...FRESH,
    });

    const result = await service.explainSenders({
      mailboxAccountId: mailboxA,
      senderIds: [opened.id],
    });

    expect(result).toEqual({ queued: [opened.id] });
    expect(queued).toHaveLength(1);
    expect(queued[0]!.data).toEqual({
      mailboxAccountId: mailboxA,
      senderKey: opened.senderKey,
      trigger: 'explain',
      producedAtMs: Date.parse('2026-09-25T08:30:00.123Z'),
    });
    // Dedupe on the ROW VERSION for an hour, and remove only this job when
    // it completes. An age-based `removeOnComplete` would sweep the whole
    // score queue's finished set on every explain completion.
    expect(queued[0]!.opts).toEqual({
      deduplication: {
        id: `explain-${mailboxA}-${opened.senderKey}-${Date.parse('2026-09-25T08:30:00.123Z')}`,
        ttl: 60 * 60 * 1000,
      },
      removeOnComplete: true,
    });
  });

  it('a second ask for the same row version within the hour is one job, not two bills', async () => {
    const opened = await seedScoredSender(mailboxA, 'twice@example.com', {
      generatedBy: 'template',
      ...FRESH,
    });

    await service.explainSenders({ mailboxAccountId: mailboxA, senderIds: [opened.id] });
    await service.explainSenders({ mailboxAccountId: mailboxA, senderIds: [opened.id] });

    expect(queued).toHaveLength(1);
  });

  /**
   * A stale row is asked about only by a surface that is NOT re-scoring it
   * (the action sheet, the Screener's decide preview). Where the stale
   * refresh runs, the page does not ask — that decision lives with the
   * page, which knows which one it is.
   */
  it('queues a stale template row too — the page decides when a re-score owns it', async () => {
    const stale = await seedScoredSender(mailboxA, 'stale-sheet@example.com', {
      generatedBy: 'template',
      producedAt: new Date('2026-09-10T00:00:00Z'),
      expiresAt: new Date('2026-09-17T00:00:00Z'),
    });

    const result = await service.explainSenders({
      mailboxAccountId: mailboxA,
      senderIds: [stale.id],
    });

    expect(result).toEqual({ queued: [stale.id] });
  });

  it('asks for nothing a row does not need', async () => {
    const explained = await seedScoredSender(mailboxA, 'explained@example.com', {
      generatedBy: 'llm_haiku',
      ...FRESH,
    });
    const unscored = await seedScoredSender(mailboxA, 'unscored@example.com', null);
    // Another mailbox's sender, by id: a guessed id must not reach it.
    const foreign = await seedScoredSender(mailboxB, 'foreign@example.com', {
      generatedBy: 'template',
      ...FRESH,
    });

    const result = await service.explainSenders({
      mailboxAccountId: mailboxA,
      senderIds: [explained.id, unscored.id, foreign.id],
    });

    expect(result).toEqual({ queued: [] });
    expect(queued).toHaveLength(0);
  });

  it('refuses to pretend when there is no queue to put the work on', async () => {
    const noQueue = new TriageService(db as never, null, null);
    await expect(
      noQueue.explainSenders({ mailboxAccountId: mailboxA, senderIds: [randomUUID()] }),
    ).rejects.toThrow(/REDIS_URL/);
  });

  /**
   * The worker explains the top `FIRST_VIEW_QUEUE_ROWS` of the queue when a
   * mailbox becomes ready. It lives in `packages/workers`, which cannot
   * import this constant — so raising the D30 ceiling without it would
   * leave the tail of the first queue on the template.
   */
  it('the worker explains at least a full queue at ready', () => {
    expect(FIRST_VIEW_QUEUE_ROWS).toBeGreaterThanOrEqual(TRIAGE_QUEUE_MAX);
  });

  /** The page asks for a whole queue in one request; the endpoint must take it. */
  it('one ask can carry a full Triage queue', () => {
    expect(EXPLAIN_BATCH_MAX).toBeGreaterThanOrEqual(TRIAGE_QUEUE_MAX);
  });
});
