import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import {
  activityLog,
  mailboxAccounts,
  mailMessages,
  schema,
  senderPolicies,
  senders,
  senderTimeseries,
  triageDecisions,
  users,
  workspaces,
} from '@declutrmail/db';
import { describe, expect, it, vi } from 'vitest';

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
      // correlate without a re-query.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(warnSpy.mock.calls[0]![0] as string) as Record<string, unknown>;
      expect(payload['kind']).toBe('reasoning.timeout');
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
});
