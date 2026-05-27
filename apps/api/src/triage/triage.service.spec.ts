import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  mailboxAccounts,
  schema,
  triageDecisions,
  users,
  workspaces,
  type TriageVerdict,
} from '@declutrmail/db';
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
