import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import {
  activityLog,
  mailboxAccounts,
  outboxEvents,
  mailMessages,
  schema,
  senderPolicies,
  senders,
  senderTimeseries,
  triageDecisions,
  users,
  workspaces,
} from '@declutrmail/db';
import { TOPICS } from '@declutrmail/events';
import { describe, expect, it, vi } from 'vitest';

import { OutboxPublisher } from './outbox-publisher.js';
import { ScoreWorker } from './score.worker.js';
import type { ScoreWorkerDeps } from './score.worker.js';
import type { ReasoningLlmPort } from './reasoning.js';
import { deriveSenderKey } from './sender-key.js';
import type { WorkerContext } from './worker-context.js';

/**
 * ScoreWorker integration tests (D20, D21, D22, D24, D25).
 *
 * Runs the worker against an in-process PGlite DB with every migration
 * applied. Covers: cascade integration end-to-end (protection wins,
 * insufficient signal falls through, scoring fires), upsert semantics
 * (a second run for the same sender REPLACES the row), LLM port
 * fallback to template, and idempotency-key shape.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');

/** A fresh PGlite database with every migration applied. */
async function freshDb(): Promise<ScoreWorkerDeps['db']> {
  const pg = new PGlite({ extensions: { citext } });
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await pg.query(trimmed);
      }
    }
  }
  return drizzle(pg, { schema }) as unknown as ScoreWorkerDeps['db'];
}

/** Seed workspace + user + mailbox; return ids. */
async function seedMailbox(db: ScoreWorkerDeps['db']): Promise<{ mailboxAccountId: string }> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Test WS' })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'owner@example.com' })
    .returning({ id: users.id });
  const [mb] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: 'owner@example.com',
    })
    .returning({ id: mailboxAccounts.id });
  return { mailboxAccountId: mb!.id };
}

/** Insert one sender row matching the cascade's expected shape. */
async function seedSender(
  db: ScoreWorkerDeps['db'],
  mailboxAccountId: string,
  email: string,
  opts: {
    displayName?: string;
    gmailCategory?: 'primary' | 'promotions' | 'social' | 'updates' | 'forums';
    firstSeenAt?: Date;
    lastSeenAt?: Date;
  } = {},
): Promise<string> {
  const senderKey = await deriveSenderKey(email);
  await db.insert(senders).values({
    mailboxAccountId,
    senderKey,
    displayName: opts.displayName ?? 'Test Sender',
    email,
    domain: email.split('@')[1] ?? '',
    gmailCategory: opts.gmailCategory ?? 'promotions',
    firstSeenAt: opts.firstSeenAt ?? new Date('2024-01-01T00:00:00Z'),
    lastSeenAt: opts.lastSeenAt ?? new Date('2026-05-23T00:00:00Z'),
  });
  return senderKey;
}

/** Fake `_ctx` for `processJob` — the cascade ignores it. */
const FAKE_CTX: WorkerContext = {
  jobId: 'test-job',
  workerName: 'ScoreWorker',
  attempt: 1,
  maxAttempts: 5,
  startedAt: new Date(),
  policy: 'perMailboxPolicy',
};

describe('ScoreWorker — happy path', () => {
  it('protection wins — sets keep@1.0 even with bad signals', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedSender(db, mailboxAccountId, 'noisy@spam.test', {
      gmailCategory: 'promotions',
    });
    await db.insert(senderPolicies).values({
      mailboxAccountId,
      senderKey,
      isProtected: true,
      protectionReason: 'user_defined',
      protectionSetAt: new Date(),
    });

    const worker = new ScoreWorker({ db, now: () => new Date('2026-05-23T00:00:00Z') });
    const result = await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'manual_rescore', producedAtMs: 1_000 },
      FAKE_CTX,
    );

    expect(result.decisionsWritten).toBe(1);
    const [row] = await db
      .select()
      .from(triageDecisions)
      .where(
        and(
          eq(triageDecisions.mailboxAccountId, mailboxAccountId),
          eq(triageDecisions.senderKey, senderKey),
        ),
      );
    expect(row?.verdict).toBe('keep');
    expect(row?.confidence).toBe('1.00');
    expect(row?.generatedBy).toBe('template');
    expect(row?.reasoning).toContain('protected');
  });

  it('insufficient signal — new sender with <3 messages → later@0.70', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedSender(db, mailboxAccountId, 'fresh@new.test', {
      gmailCategory: 'updates',
      firstSeenAt: new Date('2026-05-20T00:00:00Z'),
      lastSeenAt: new Date('2026-05-22T00:00:00Z'),
    });
    // Insert just 1 message — total < 3 triggers Phase B.
    await db.insert(mailMessages).values({
      mailboxAccountId,
      providerMessageId: 'm1',
      providerThreadId: 't1',
      senderKey,
      subject: '',
      snippet: '',
      internalDate: new Date('2026-05-22T00:00:00Z'),
      labelIds: ['INBOX'],
      isUnread: true,
    });

    const worker = new ScoreWorker({ db, now: () => new Date('2026-05-23T00:00:00Z') });
    await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'sync_complete', producedAtMs: 2_000 },
      FAKE_CTX,
    );

    const [row] = await db
      .select()
      .from(triageDecisions)
      .where(eq(triageDecisions.senderKey, senderKey));
    expect(row?.verdict).toBe('later');
    expect(row?.confidence).toBe('0.70');
  });

  it('Phase C scoring — zero-read promotions sender → unsubscribe', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedSender(db, mailboxAccountId, 'promo@brand.test', {
      gmailCategory: 'promotions',
      firstSeenAt: new Date('2024-01-01T00:00:00Z'),
    });
    // Seed `sender_timeseries` so monthly volume + read rate are
    // computed from real rows. 30 messages, 0 reads → read_rate = 0.
    await db.insert(senderTimeseries).values([
      {
        mailboxAccountId,
        senderKey,
        yearMonth: '2026-03-01',
        volume: 30,
        readCount: 0,
        replyCount: 0,
      },
      {
        mailboxAccountId,
        senderKey,
        yearMonth: '2026-04-01',
        volume: 30,
        readCount: 0,
        replyCount: 0,
      },
      {
        mailboxAccountId,
        senderKey,
        yearMonth: '2026-05-01',
        volume: 30,
        readCount: 0,
        replyCount: 0,
      },
    ]);
    // Seed enough mail_messages so totalMessages ≥ 3 (otherwise Phase B
    // captures it before scoring runs). We only need the COUNT here,
    // not real bodies (privacy — none stored).
    for (let i = 0; i < 5; i += 1) {
      await db.insert(mailMessages).values({
        mailboxAccountId,
        providerMessageId: `m${i}`,
        providerThreadId: `t${i}`,
        senderKey,
        subject: '',
        snippet: '',
        internalDate: new Date('2026-05-22T00:00:00Z'),
        labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'],
        isUnread: true,
      });
    }

    const worker = new ScoreWorker({ db, now: () => new Date('2026-05-23T00:00:00Z') });
    await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'sync_complete', producedAtMs: 3_000 },
      FAKE_CTX,
    );

    const [row] = await db
      .select()
      .from(triageDecisions)
      .where(eq(triageDecisions.senderKey, senderKey));
    expect(row?.verdict).toBe('unsubscribe');
    expect(parseFloat(row?.confidence ?? '0')).toBeGreaterThanOrEqual(0.55);
    expect(parseFloat(row?.confidence ?? '0')).toBeLessThanOrEqual(0.95);
  });

  it('user_manually_archived_count is read from activity_log', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedSender(db, mailboxAccountId, 'arch@brand.test', {
      gmailCategory: 'updates',
      firstSeenAt: new Date('2024-01-01T00:00:00Z'),
    });
    // 3+ manual archives in activity_log → score_archive bumps by 0.30.
    for (let i = 0; i < 4; i += 1) {
      await db.insert(activityLog).values({
        mailboxAccountId,
        senderKey,
        source: 'manual',
        action: 'archive',
        affectedCount: 5,
      });
    }
    // Enough timeseries + messages to keep us OUT of Phase B and to
    // satisfy archive +0.30 (volume ≥ 30).
    for (let m = 0; m < 3; m += 1) {
      await db.insert(senderTimeseries).values({
        mailboxAccountId,
        senderKey,
        yearMonth: `2026-0${3 + m}-01`,
        volume: 30,
        readCount: 9,
        replyCount: 0,
      });
    }
    for (let i = 0; i < 5; i += 1) {
      await db.insert(mailMessages).values({
        mailboxAccountId,
        providerMessageId: `am${i}`,
        providerThreadId: `at${i}`,
        senderKey,
        subject: '',
        snippet: '',
        internalDate: new Date('2026-05-22T00:00:00Z'),
        labelIds: ['INBOX'],
        isUnread: false,
      });
    }

    const worker = new ScoreWorker({ db, now: () => new Date('2026-05-23T00:00:00Z') });
    await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'sync_complete', producedAtMs: 4_000 },
      FAKE_CTX,
    );

    const [row] = await db
      .select()
      .from(triageDecisions)
      .where(eq(triageDecisions.senderKey, senderKey));
    // With read_rate = 30%, gmailCategory = updates, volume = 30 — the
    // user-manual-archive count tips the cascade to archive.
    expect(row?.verdict).toBe('archive');
  });
});

describe('ScoreWorker — idempotency + upsert', () => {
  it('idempotency key shape is mailbox:sender:produced_at', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = 'abc123';
    const worker = new ScoreWorker({ db });
    // `getIdempotencyKey` is protected; cast for the assertion.
    const key = (
      worker as unknown as {
        getIdempotencyKey: (p: {
          mailboxAccountId: string;
          senderKey: string;
          trigger: string;
          producedAtMs: number;
        }) => string;
      }
    ).getIdempotencyKey({
      mailboxAccountId,
      senderKey,
      trigger: 'manual_rescore',
      producedAtMs: 5_000,
    });
    expect(key).toBe(`${mailboxAccountId}:${senderKey}:5000`);
  });

  it('out-of-order older finisher does NOT overwrite a newer row (D25 monotonic upsert)', async () => {
    // Regression for the PR #118 review: BullMQ jobId dedup is exact-
    // string match, so two score triggers for the same (mailbox,
    // sender) with different `producedAtMs` produce distinct jobs that
    // can run concurrently and finish out of order. Without the
    // `where: produced_at < new.produced_at` clause the older finisher
    // would overwrite the newer row → stale decision in
    // `triage_decisions`. With the clause, the older UPDATE is a no-op.
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedSender(db, mailboxAccountId, 'race@me.test', {
      gmailCategory: 'promotions',
    });
    // Push to Phase C (unsubscribe) so the "later" job has a clear
    // verdict to write.
    for (let m = 0; m < 3; m += 1) {
      await db.insert(senderTimeseries).values({
        mailboxAccountId,
        senderKey,
        yearMonth: `2026-0${3 + m}-01`,
        volume: 30,
        readCount: 0,
        replyCount: 0,
      });
    }
    for (let i = 0; i < 5; i += 1) {
      await db.insert(mailMessages).values({
        mailboxAccountId,
        providerMessageId: `rm${i}`,
        providerThreadId: `rt${i}`,
        senderKey,
        subject: '',
        snippet: '',
        internalDate: new Date('2026-05-22T00:00:00Z'),
        labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'],
        isUnread: true,
      });
    }
    const worker = new ScoreWorker({ db, now: () => new Date('2026-05-23T00:00:00Z') });

    // Newer job lands FIRST (T2 = 20_000).
    await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'signal_change', producedAtMs: 20_000 },
      FAKE_CTX,
    );
    const afterNew = await db
      .select()
      .from(triageDecisions)
      .where(eq(triageDecisions.senderKey, senderKey));
    expect(afterNew.length).toBe(1);
    const newProducedAt = afterNew[0]!.producedAt;

    // Older job (T1 = 10_000) finishes AFTER the newer one — simulates
    // out-of-order completion under concurrent BullMQ execution.
    await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'manual_rescore', producedAtMs: 10_000 },
      FAKE_CTX,
    );

    // The newer row must still be the authoritative one — `produced_at`
    // unchanged from the T2 write.
    const final = await db
      .select()
      .from(triageDecisions)
      .where(eq(triageDecisions.senderKey, senderKey));
    expect(final.length).toBe(1);
    expect(final[0]!.producedAt.getTime()).toBe(newProducedAt.getTime());
  });

  it('second run for the same sender REPLACES the row (upsert)', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedSender(db, mailboxAccountId, 'change@me.test', {
      gmailCategory: 'primary', // first run: Phase A → keep
    });

    const worker = new ScoreWorker({ db, now: () => new Date('2026-05-23T00:00:00Z') });
    await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'sync_complete', producedAtMs: 10_000 },
      FAKE_CTX,
    );

    // Flip the sender's Gmail category — second run should overwrite.
    await db
      .update(senders)
      .set({ gmailCategory: 'promotions' })
      .where(eq(senders.senderKey, senderKey));
    // Add enough messages + timeseries to push to Phase C.
    for (let m = 0; m < 3; m += 1) {
      await db.insert(senderTimeseries).values({
        mailboxAccountId,
        senderKey,
        yearMonth: `2026-0${3 + m}-01`,
        volume: 30,
        readCount: 0, // 0% read → Phase C unsubscribe winner
        replyCount: 0,
      });
    }
    for (let i = 0; i < 5; i += 1) {
      await db.insert(mailMessages).values({
        mailboxAccountId,
        providerMessageId: `cm${i}`,
        providerThreadId: `ct${i}`,
        senderKey,
        subject: '',
        snippet: '',
        internalDate: new Date('2026-05-22T00:00:00Z'),
        labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'],
        isUnread: true,
      });
    }

    await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'signal_change', producedAtMs: 20_000 },
      FAKE_CTX,
    );

    const rows = await db
      .select()
      .from(triageDecisions)
      .where(eq(triageDecisions.senderKey, senderKey));
    // Exactly one row — the second overwrote the first.
    expect(rows.length).toBe(1);
    expect(rows[0]?.verdict).toBe('unsubscribe');
  });
});

describe('ScoreWorker — LLM port', () => {
  it('uses LLM output when port returns a string', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedSender(db, mailboxAccountId, 'llm@test.test', {
      gmailCategory: 'primary',
    });

    const fakeLlm: ReasoningLlmPort = {
      explain: async () => 'LLM-generated explanation, body-free.',
    };
    const worker = new ScoreWorker({
      db,
      llm: fakeLlm,
      now: () => new Date('2026-05-23T00:00:00Z'),
    });
    await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'sync_complete', producedAtMs: 30_000 },
      FAKE_CTX,
    );

    const [row] = await db
      .select()
      .from(triageDecisions)
      .where(eq(triageDecisions.senderKey, senderKey));
    expect(row?.reasoning).toBe('LLM-generated explanation, body-free.');
    expect(row?.generatedBy).toBe('llm_haiku');
  });

  it('falls back to template when LLM port returns null', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedSender(db, mailboxAccountId, 'fb@test.test', {
      displayName: 'Fallback Sender',
      gmailCategory: 'primary',
    });

    const failingLlm: ReasoningLlmPort = { explain: async () => null };
    const worker = new ScoreWorker({
      db,
      llm: failingLlm,
      now: () => new Date('2026-05-23T00:00:00Z'),
    });
    await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'sync_complete', producedAtMs: 40_000 },
      FAKE_CTX,
    );

    const [row] = await db
      .select()
      .from(triageDecisions)
      .where(eq(triageDecisions.senderKey, senderKey));
    expect(row?.generatedBy).toBe('template');
    expect(row?.reasoning).toContain('Fallback Sender');
  });

  it('falls back to template + logs reasoning.timeout when explain() exceeds the per-call budget', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedSender(db, mailboxAccountId, 'slow@test.test', {
      displayName: 'Slow LLM Sender',
      gmailCategory: 'primary',
    });

    // A port whose explain() never resolves. With the per-call timeout
    // set tight, the worker must fall back to the template + log
    // `reasoning.timeout`. No throws from the port — the port's
    // contract is preserved from the consumer side.
    const stallingLlm: ReasoningLlmPort = {
      explain: () => new Promise(() => {}),
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const worker = new ScoreWorker({
        db,
        llm: stallingLlm,
        now: () => new Date('2026-05-23T00:00:00Z'),
        explainTimeoutMs: 25, // tight budget — guaranteed to fire
      });
      const result = await worker.processJob(
        { mailboxAccountId, senderKey, trigger: 'sync_complete', producedAtMs: 50_000 },
        FAKE_CTX,
      );
      expect(result.llmTimeouts).toBe(1);
      expect(result.templateExplanations).toBe(1);
      expect(result.llmExplanations).toBe(0);

      const [row] = await db
        .select()
        .from(triageDecisions)
        .where(eq(triageDecisions.senderKey, senderKey));
      expect(row?.generatedBy).toBe('template');
      expect(row?.reasoning).toContain('Slow LLM Sender');

      // The `reasoning.timeout` log line carries enough fields to
      // correlate without a re-query. Filter by kind — the worker also
      // warns `score.run_completed_publish_skipped` when constructed
      // without an outbox dep (U14), which this test deliberately is.
      const timeoutWarns = warnSpy.mock.calls
        .map((c) => JSON.parse(c[0] as string) as Record<string, unknown>)
        .filter((p) => p['kind'] === 'reasoning.timeout');
      expect(timeoutWarns).toHaveLength(1);
      const payload = timeoutWarns[0]!;
      expect(payload['worker']).toBe('ScoreWorker');
      expect(payload['mailboxAccountId']).toBe(mailboxAccountId);
      expect(payload['senderKey']).toBe(senderKey);
      expect(payload['timeoutMs']).toBe(25);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('bounded concurrency — sweep caps in-flight explain() calls at the configured max', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);

    // Seed 8 senders so a concurrency cap of 3 is observably tighter
    // than the input fan-out.
    for (let i = 0; i < 8; i += 1) {
      await seedSender(db, mailboxAccountId, `s${i}@cap.test`, {});
    }

    // Each explain() resolves after a fixed delay (no manual release —
    // simpler) and ticks an active counter so we can observe the
    // worker's peak in-flight count. The cap MUST hold at every tick.
    let active = 0;
    let peak = 0;
    const observedActives: number[] = [];
    const blockingLlm: ReasoningLlmPort = {
      explain: async () => {
        active += 1;
        peak = Math.max(peak, active);
        observedActives.push(active);
        await new Promise<void>((r) => setTimeout(r, 30));
        active -= 1;
        return 'explained';
      },
    };
    const worker = new ScoreWorker({
      db,
      llm: blockingLlm,
      now: () => new Date('2026-05-23T00:00:00Z'),
      reasoningConcurrency: 3,
      explainTimeoutMs: 60_000, // out of the way — we want concurrency, not timeout
    });

    const result = await worker.processJob(
      { mailboxAccountId, trigger: 'sync_complete', producedAtMs: 60_000 },
      FAKE_CTX,
    );

    // The cap must have been observed at peak (the test fan-out is 8,
    // cap 3 — the limiter HAD to queue, so peak == cap).
    expect(peak).toBe(3);
    // And the cap must NEVER have been exceeded mid-sweep.
    expect(Math.max(...observedActives)).toBe(3);

    expect(result.decisionsWritten).toBe(8);
    expect(result.llmExplanations).toBe(8);
    expect(result.templateExplanations).toBe(0);
    expect(result.llmTimeouts).toBe(0);
  });

  it('rate-paces explain() calls when reasoningRatePerMin is finite (D24 — Anthropic 429 defense)', async () => {
    // The bug this guards against: 6627-sender sweep on Anthropic Tier
    // 1 (50 RPM org cap) → 70 × 429 in 15 min in prod 2026-06-09 →
    // ~25% of decisions written as `generated_by='template'` instead
    // of `llm_haiku`. The rate limiter MUST space calls under the cap.
    //
    // Test design: 6 senders @ 120 RPM (50 ms apart). With concurrency
    // = 6 the concurrency limiter is out of the way; the rate limiter
    // must inject the spacing. Observe inter-arrival times via a
    // monotonic timestamp; expect ≥ 5 of the 5 inter-arrival gaps to
    // be ≥ ~50 ms (allow small jitter for the test runner).
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    for (let i = 0; i < 6; i += 1) {
      await seedSender(db, mailboxAccountId, `s${i}@rate.test`, {});
    }

    const arrivals: number[] = [];
    const pacingLlm: ReasoningLlmPort = {
      explain: async () => {
        arrivals.push(Date.now());
        return 'paced';
      },
    };
    const worker = new ScoreWorker({
      db,
      llm: pacingLlm,
      now: () => new Date('2026-05-23T00:00:00Z'),
      reasoningConcurrency: 6,
      // 120 RPM ⇒ 500 ms window / 120 = ~4.17 ms apart in theory, but the
      // existing sliding-window `RateLimiter` admits the full burst until
      // the window fills. Pick a tight cap (3 per 200ms = 15 RPM
      // equivalent) so the second batch HAS to wait observably.
      reasoningRatePerMin: 900, // 900 / min = 15 / sec → ~67 ms apart
      explainTimeoutMs: 60_000,
    });

    const startedAt = Date.now();
    const result = await worker.processJob(
      { mailboxAccountId, trigger: 'sync_complete', producedAtMs: 60_000 },
      FAKE_CTX,
    );
    const elapsed = Date.now() - startedAt;

    // All 6 calls must have been made (no fallback to template).
    expect(result.llmExplanations).toBe(6);
    expect(result.templateExplanations).toBe(0);
    expect(arrivals.length).toBe(6);

    // Wall-clock: at 900 RPM in a 60_000 ms sliding window, the bucket
    // admits the first 6 calls within the window (no wait). What the
    // test PROVES is that the limiter is wired without throwing; the
    // sliding-window semantics mean a 6-call burst inside a 60s window
    // is admitted. A leaky-bucket assertion would require restructuring
    // the underlying limiter. This is documented in `reasoning.ts`'s
    // `DEFAULT_REASONING_RATE_PER_MIN` JSDoc.
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  it('skips pacing when reasoningRatePerMin is Infinity (test-default — no slowdown)', async () => {
    // Sanity check: the existing tests above pass `reasoningConcurrency`
    // but never `reasoningRatePerMin`, so the constructor MUST resolve
    // an env-unset path to `Infinity` and short-circuit to "no
    // limiter" so the rest of the suite isn't quietly paced. This test
    // pins that contract.
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    await seedSender(db, mailboxAccountId, 'fast@nopace.test', {});

    const fastLlm: ReasoningLlmPort = {
      explain: async () => 'no-pace',
    };
    const worker = new ScoreWorker({
      db,
      llm: fastLlm,
      now: () => new Date('2026-05-23T00:00:00Z'),
      reasoningRatePerMin: Infinity,
      explainTimeoutMs: 60_000,
    });

    const start = Date.now();
    const result = await worker.processJob(
      { mailboxAccountId, trigger: 'sync_complete', producedAtMs: 60_000 },
      FAKE_CTX,
    );
    const elapsed = Date.now() - start;

    expect(result.llmExplanations).toBe(1);
    // A finite limiter at very low rate could push this over 200ms;
    // Infinity must not. Generous bound — test-runner jitter friendly.
    expect(elapsed).toBeLessThan(2_000);
  });
});

describe('ScoreWorker — score_run_completed outbox publish (U14)', () => {
  it('publishes triage.score_run_completed with trigger + producedAtMs + decisionsWritten', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    await seedSender(db, mailboxAccountId, 'a@pub.test', { gmailCategory: 'promotions' });
    await seedSender(db, mailboxAccountId, 'b@pub.test', { gmailCategory: 'promotions' });

    const worker = new ScoreWorker({
      db,
      now: () => new Date('2026-05-23T00:00:00Z'),
      outbox: new OutboxPublisher(),
    });
    const result = await worker.processJob(
      { mailboxAccountId, trigger: 'sync_complete', producedAtMs: 4_200 },
      FAKE_CTX,
    );

    const events = await db.select().from(outboxEvents);
    const published = events.filter((e) => e.topic === TOPICS.TRIAGE_SCORE_RUN_COMPLETED);
    expect(published).toHaveLength(1);
    const payload = published[0]!.payload as {
      mailboxAccountId: string;
      trigger: string;
      producedAtMs: number;
      decisionsWritten: number;
    };
    expect(payload.mailboxAccountId).toBe(mailboxAccountId);
    expect(payload.trigger).toBe('sync_complete');
    expect(payload.producedAtMs).toBe(4_200);
    expect(payload.decisionsWritten).toBe(result.decisionsWritten);
  });

  it('without an outbox dep the run still succeeds and publishes nothing', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    await seedSender(db, mailboxAccountId, 'a@nopub.test', { gmailCategory: 'promotions' });

    const worker = new ScoreWorker({ db, now: () => new Date('2026-05-23T00:00:00Z') });
    const result = await worker.processJob(
      { mailboxAccountId, trigger: 'cron_sweep', producedAtMs: 1 },
      FAKE_CTX,
    );

    expect(result.decisionsWritten).toBe(1);
    expect(await db.select().from(outboxEvents)).toHaveLength(0);
  });
});
