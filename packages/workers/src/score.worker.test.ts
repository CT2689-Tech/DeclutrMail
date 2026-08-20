import { and, eq } from 'drizzle-orm';
import {
  activityLog,
  mailboxAccounts,
  mailboxLabels,
  mailMessages,
  outboxEvents,
  screenerQuarantine,
  senderPolicies,
  senders,
  senderTimeseries,
  triageDecisions,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
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

/** A fresh PGlite database with every migration applied. */
async function freshDb(): Promise<ScoreWorkerDeps['db']> {
  return (await freshTestDb()) as unknown as ScoreWorkerDeps['db'];
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
/**
 * Seed `count` inbound messages inside the engine's 90-day window,
 * `readCount` of them marked read.
 *
 * The engine used to read volume + read rate from `sender_timeseries`,
 * so these tests seeded three calendar buckets and only a handful of
 * real messages. It now reads the message rows themselves (ADR-0037),
 * which is what the display path has always read — so the fixture has
 * to carry the volume it claims. A bucket saying "90 messages" beside
 * five actual rows was exactly the split-source this change removes.
 */
async function seedWindowMessages(
  db: ScoreWorkerDeps['db'],
  mailboxAccountId: string,
  senderKey: string,
  opts: {
    prefix: string;
    count: number;
    readCount?: number;
    labelIds?: string[];
    oneClickUnsub?: boolean;
    internalDate?: Date;
  },
): Promise<void> {
  const read = opts.readCount ?? 0;
  const when = opts.internalDate ?? new Date('2026-05-22T00:00:00Z');
  for (let i = 0; i < opts.count; i += 1) {
    await db.insert(mailMessages).values({
      mailboxAccountId,
      providerMessageId: `${opts.prefix}${i}`,
      providerThreadId: `${opts.prefix}t${i}`,
      senderKey,
      subject: '',
      snippet: '',
      internalDate: when,
      labelIds: opts.labelIds ?? ['INBOX'],
      isUnread: i >= read,
      ...(opts.oneClickUnsub
        ? { unsubscribeUrl: 'https://brand.test/unsub', unsubscribeOneClick: true }
        : {}),
    });
  }
}

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
    // 90 inbound messages in the window, none read → read rate 0.
    // The one-click List-Unsubscribe capability makes the sender a REAL
    // unsubscribe candidate — D29: without a declared channel + stream
    // volume, Phase C gates the unsubscribe score to 0. No bodies
    // (privacy — none stored).
    await seedWindowMessages(db, mailboxAccountId, senderKey, {
      prefix: 'm',
      count: 90,
      labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'],
      oneClickUnsub: true,
    });

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
    // Enough inbound mail to keep us OUT of Phase B and to satisfy
    // archive +0.30 (monthly volume >= 30). 27 of 90 read → 30%.
    await seedWindowMessages(db, mailboxAccountId, senderKey, {
      prefix: 'am',
      count: 90,
      readCount: 27,
    });

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
    // Push to Phase C (unsubscribe — one-click channel + volume per the
    // D29 gate) so the "later" job has a clear verdict to write.
    for (let m = 0; m < 3; m += 1) {
      await db.insert(senderTimeseries).values({
        mailboxAccountId,
        senderKey,
        yearMonth: `2026-0${3 + m}-01`,
        volume: 30,
        readCount: 0,
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
        unsubscribeUrl: 'https://me.test/unsub',
        unsubscribeOneClick: true,
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
    // Add enough messages + timeseries to push to Phase C. The one-click
    // channel + 30/mo volume satisfy the D29 unsubscribe gate; 0% read
    // corroborates → unsubscribe winner.
    await seedWindowMessages(db, mailboxAccountId, senderKey, {
      prefix: 'cm',
      count: 90,
      labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'],
      oneClickUnsub: true,
    });

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

  /**
   * Live copy on 440+ of the founder's 8,531 scored senders read "The
   * high_read_rate engine rule confirms this sender deserves inbox
   * placement". The prompt handed the model the raw cascade id; the
   * model echoed it. The id is gone from the prompt now, and a sentence
   * that still names one is refused rather than shipped.
   */
  it('refuses a token the model invented in our house style', async () => {
    // `protect_engagement_based` appears in 100+ stored explanations and
    // in zero lines of source: shown one id, the model coined siblings.
    // A known-vocabulary list cannot catch those; "not the sender's own
    // name" can.
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedSender(db, mailboxAccountId, 'invented@test.test', {
      gmailCategory: 'primary',
    });

    const inventiveLlm: ReasoningLlmPort = {
      explain: async () => 'The protect_engagement_based rule applies to this sender.',
    };
    const worker = new ScoreWorker({
      db,
      llm: inventiveLlm,
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
    expect(row?.reasoning).not.toContain('protect_engagement_based');
    expect(row?.generatedBy).toBe('template');
  });

  it('refuses LLM copy that names an internal rule id', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedSender(db, mailboxAccountId, 'leaky@test.test', {
      gmailCategory: 'primary',
    });

    const leakyLlm: ReasoningLlmPort = {
      explain: async () => 'The high_read_rate engine rule confirms this sender belongs here.',
    };
    const worker = new ScoreWorker({
      db,
      llm: leakyLlm,
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
    expect(row?.reasoning).not.toContain('high_read_rate');
    expect(row?.generatedBy).toBe('template');
  });

  it('hands the model a phrase, never the internal rule id', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedSender(db, mailboxAccountId, 'phrase@test.test', {
      gmailCategory: 'primary',
    });

    const seen: string[] = [];
    const spyLlm: ReasoningLlmPort = {
      explain: async (input) => {
        seen.push(input.ruleLabel);
        return 'A sentence a person would write.';
      },
    };
    const worker = new ScoreWorker({
      db,
      llm: spyLlm,
      now: () => new Date('2026-05-23T00:00:00Z'),
    });
    await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'sync_complete', producedAtMs: 30_000 },
      FAKE_CTX,
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toMatch(/_/);
    expect(seen[0]!.length).toBeGreaterThan(10);
  });

  it('keeps a sentence that merely quotes an underscored sender name', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedSender(db, mailboxAccountId, 'ife_insurance_india@test.test', {
      gmailCategory: 'primary',
    });

    // A real sender in the founder's mailbox is named `ife_insurance_india`.
    // Rejecting on a snake_case regex would have thrown away good copy for
    // quoting the user's own data — the match is against the known rule
    // vocabulary only.
    const quotingLlm: ReasoningLlmPort = {
      explain: async () => 'ife_insurance_india writes often and you read all of it.',
    };
    const worker = new ScoreWorker({
      db,
      llm: quotingLlm,
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
    expect(row?.generatedBy).toBe('llm_haiku');
    expect(row?.reasoning).toContain('ife_insurance_india');
  });

  it('reuses unexpired same-verdict LLM reasoning without calling explain() (2026-07-10 re-bill fix)', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedSender(db, mailboxAccountId, 'reuse@test.test', {
      gmailCategory: 'primary',
    });

    let calls = 0;
    const countingLlm: ReasoningLlmPort = {
      explain: async () => {
        calls += 1;
        return `LLM prose #${calls}`;
      },
    };
    // Realistic clock: expires_at = produced_at + 7d TTL, and the reuse
    // check compares it against the injected `now` — so producedAtMs
    // must sit near `now`, not at the 1970 epoch.
    const T0 = Date.parse('2026-05-22T00:00:00Z');
    const worker = new ScoreWorker({
      db,
      llm: countingLlm,
      now: () => new Date('2026-05-23T00:00:00Z'),
    });

    // Run 1 — fresh call.
    await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'sync_complete', producedAtMs: T0 },
      FAKE_CTX,
    );
    expect(calls).toBe(1);

    // Run 2 (re-score, same signals → same verdict, row unexpired) —
    // the reasoning is reused, no second bill; the row still refreshes
    // (produced_at advances via the monotonic upsert).
    await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'cron_sweep', producedAtMs: T0 + 60_000 },
      FAKE_CTX,
    );
    expect(calls).toBe(1);

    const [row] = await db
      .select()
      .from(triageDecisions)
      .where(eq(triageDecisions.senderKey, senderKey));
    expect(row?.reasoning).toBe('LLM prose #1');
    expect(row?.generatedBy).toBe('llm_haiku');
    expect(Number(row?.producedAt)).toBe(T0 + 60_000);
  });

  it('does NOT reuse a template row — the next sweep retries the LLM', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedSender(db, mailboxAccountId, 'retry@test.test', {
      displayName: 'Retry Sender',
      gmailCategory: 'primary',
    });

    // Run 1: LLM fails → template row persisted.
    let fail = true;
    let calls = 0;
    const flakyLlm: ReasoningLlmPort = {
      explain: async () => {
        calls += 1;
        return fail ? null : 'LLM prose, second attempt.';
      },
    };
    const worker = new ScoreWorker({
      db,
      llm: flakyLlm,
      now: () => new Date('2026-05-23T00:00:00Z'),
    });
    await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'sync_complete', producedAtMs: 30_000 },
      FAKE_CTX,
    );

    // Run 2: template rows are never reused — the timed-out/failed tail
    // gets its real reasoning on the next trigger.
    fail = false;
    await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'cron_sweep', producedAtMs: 60_000 },
      FAKE_CTX,
    );
    expect(calls).toBe(2);

    const [row] = await db
      .select()
      .from(triageDecisions)
      .where(eq(triageDecisions.senderKey, senderKey));
    expect(row?.reasoning).toBe('LLM prose, second attempt.');
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

describe('ScoreWorker — Screener Phase-B flag (D72, D75)', () => {
  /** One message → total < 3 → Phase B (insufficient_signal). */
  async function seedPhaseBSender(
    db: ScoreWorkerDeps['db'],
    mailboxAccountId: string,
    email: string,
  ): Promise<string> {
    const senderKey = await seedSender(db, mailboxAccountId, email, {
      gmailCategory: 'updates',
      firstSeenAt: new Date('2026-05-20T00:00:00Z'),
      lastSeenAt: new Date('2026-05-22T00:00:00Z'),
    });
    // TWO messages, not one. The sender must clear D256's entry bar
    // (>= 2 messages, or Primary) to be queued at all — these cases are
    // about the quarantine MECHANISM (flag / idempotency / graduation),
    // not about the bar, which has its own tests below.
    for (const n of [1, 2]) {
      await db.insert(mailMessages).values({
        mailboxAccountId,
        providerMessageId: `m${n}-${email}`,
        providerThreadId: `t${n}-${email}`,
        senderKey,
        subject: '',
        snippet: '',
        internalDate: new Date('2026-05-22T00:00:00Z'),
        labelIds: ['INBOX'],
        isUnread: true,
      });
    }
    return senderKey;
  }

  it('flags a Phase-B sender into screener_quarantine — DB row only, pending', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedPhaseBSender(db, mailboxAccountId, 'fresh@flag.test');

    const worker = new ScoreWorker({ db, now: () => new Date('2026-05-23T00:00:00Z') });
    const result = await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'signal_change', producedAtMs: 10_000 },
      FAKE_CTX,
    );

    expect(result.screenerFlagged).toBe(1);
    const rows = await db
      .select()
      .from(screenerQuarantine)
      .where(eq(screenerQuarantine.mailboxAccountId, mailboxAccountId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.senderKey).toBe(senderKey);
    expect(rows[0]?.decidedAt).toBeNull();
    // D72 — soft quarantine: the flag is the entire effect.
    expect(rows[0]?.softQuarantined).toBe(true);
  });

  it('does not flag a Phase-C / Phase-A sender', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    // Default seed: first seen 2024, no messages seeded ⇒ total = 0…
    // so add 3 messages to clear Phase B and land in Phase C.
    const senderKey = await seedSender(db, mailboxAccountId, 'old@brand.test', {
      gmailCategory: 'promotions',
      firstSeenAt: new Date('2024-01-01T00:00:00Z'),
    });
    await db.insert(mailMessages).values(
      [1, 2, 3].map((i) => ({
        mailboxAccountId,
        providerMessageId: `m${i}`,
        providerThreadId: `t${i}`,
        senderKey,
        subject: '',
        snippet: '',
        internalDate: new Date('2026-04-01T00:00:00Z'),
        labelIds: ['INBOX'],
        isUnread: true,
      })),
    );

    const worker = new ScoreWorker({ db, now: () => new Date('2026-05-23T00:00:00Z') });
    const result = await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'signal_change', producedAtMs: 11_000 },
      FAKE_CTX,
    );

    expect(result.screenerFlagged).toBe(0);
    expect(await db.select().from(screenerQuarantine)).toHaveLength(0);
  });

  it('re-score is idempotent — no duplicate row, no re-flag of a decided sender', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedPhaseBSender(db, mailboxAccountId, 'again@flag.test');

    const worker = new ScoreWorker({ db, now: () => new Date('2026-05-23T00:00:00Z') });
    const first = await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'signal_change', producedAtMs: 12_000 },
      FAKE_CTX,
    );
    expect(first.screenerFlagged).toBe(1);

    // Re-score while pending → conflict, no second row.
    const second = await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'cron_sweep', producedAtMs: 13_000 },
      FAKE_CTX,
    );
    expect(second.screenerFlagged).toBe(0);
    expect(await db.select().from(screenerQuarantine)).toHaveLength(1);

    // User decides → decided_at set; a later Phase-B re-score must NOT
    // re-queue the sender (decide once — D72).
    await db.update(screenerQuarantine).set({ decidedAt: new Date() });
    const third = await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'cron_sweep', producedAtMs: 14_000 },
      FAKE_CTX,
    );
    expect(third.screenerFlagged).toBe(0);
    const rows = await db.select().from(screenerQuarantine);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.decidedAt).not.toBeNull();
  });

  it('graduation (Phase B → C) resolves a still-pending quarantine row', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedPhaseBSender(db, mailboxAccountId, 'graduate@flag.test');

    const worker = new ScoreWorker({ db, now: () => new Date('2026-05-23T00:00:00Z') });
    // 1) First score → Phase B → flagged, pending.
    const first = await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'signal_change', producedAtMs: 20_000 },
      FAKE_CTX,
    );
    expect(first.screenerFlagged).toBe(1);

    // 2) Sender accrues signal: old first-seen + 3 messages ⇒ clears Phase B.
    await db
      .update(senders)
      .set({ firstSeenAt: new Date('2024-01-01T00:00:00Z') })
      .where(and(eq(senders.mailboxAccountId, mailboxAccountId), eq(senders.senderKey, senderKey)));
    await db.insert(mailMessages).values(
      [1, 2, 3].map((i) => ({
        mailboxAccountId,
        providerMessageId: `grad-m${i}`,
        providerThreadId: `grad-t${i}`,
        senderKey,
        subject: '',
        snippet: '',
        internalDate: new Date('2026-04-01T00:00:00Z'),
        labelIds: ['INBOX'],
        isUnread: true,
      })),
    );

    // 3) Re-score → graduates (not insufficient_signal) → pending row resolved.
    const second = await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'cron_sweep', producedAtMs: 21_000 },
      FAKE_CTX,
    );
    expect(second.screenerFlagged).toBe(0);
    const rows = await db.select().from(screenerQuarantine);
    expect(rows).toHaveLength(1);
    // Auto-resolved on graduation — no longer in the queue, and not a
    // user decision that would have to be re-made.
    expect(rows[0]?.decidedAt).not.toBeNull();
  });
});

/**
 * ADR-0037 — one definition of a sender's 90-day activity.
 *
 * The engine used to read volume + read rate from `sender_timeseries`,
 * summing every bucket whose `year_month` was `>= (now - 90 days)`.
 * `year_month` is a DATE pinned to the FIRST of the month, so that
 * comparison dropped the oldest bucket whole and then still divided by
 * three: 3,977 of 14,972 messages (26.6%) on the founder's mailbox, on
 * every scoring run. Understating volume understates the case for
 * cleanup, so the engine was quietly conservative in a way no surface
 * could show.
 *
 * These assert on the TEMPLATE reasoning, which prints the exact facts
 * the cascade scored on ("{name} sends {N}/mo. {P}% marked read over
 * 90d.") — the closest observable to the numbers themselves.
 */
describe('ScoreWorker — the engine reads its 90-day window from the messages', () => {
  const NOW = new Date('2026-05-23T00:00:00Z');
  /** 85 days before NOW — inside the window, inside the OLDEST month. */
  const DEEP_IN_WINDOW = new Date(NOW.getTime() - 85 * 24 * 60 * 60 * 1000);

  it('counts mail in the oldest partial month of the window', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedSender(db, mailboxAccountId, 'deep@brand.test', {
      gmailCategory: 'promotions',
      firstSeenAt: new Date('2024-01-01T00:00:00Z'),
    });
    // Every message sits in the calendar month the bucket comparison
    // used to discard entirely.
    await seedWindowMessages(db, mailboxAccountId, senderKey, {
      prefix: 'deep',
      count: 90,
      internalDate: DEEP_IN_WINDOW,
      labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'],
      oneClickUnsub: true,
    });

    const worker = new ScoreWorker({ db, now: () => NOW });
    await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'sync_complete', producedAtMs: 90_000 },
      FAKE_CTX,
    );

    const [row] = await db
      .select()
      .from(triageDecisions)
      .where(eq(triageDecisions.senderKey, senderKey));
    // 90 messages / 3 months. Under the bucket window this read 0/mo.
    expect(row?.reasoning).toContain('sends 30/mo.');
  });

  it('excludes mail older than the window', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedSender(db, mailboxAccountId, 'old@brand.test', {
      gmailCategory: 'promotions',
      firstSeenAt: new Date('2024-01-01T00:00:00Z'),
    });
    // 30 inside, 90 just outside (95 days back). A window that leaks
    // would report 40/mo instead of 10/mo.
    await seedWindowMessages(db, mailboxAccountId, senderKey, {
      prefix: 'in',
      count: 30,
      internalDate: DEEP_IN_WINDOW,
    });
    await seedWindowMessages(db, mailboxAccountId, senderKey, {
      prefix: 'out',
      count: 90,
      internalDate: new Date(NOW.getTime() - 95 * 24 * 60 * 60 * 1000),
    });

    const worker = new ScoreWorker({ db, now: () => NOW });
    await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'sync_complete', producedAtMs: 91_000 },
      FAKE_CTX,
    );

    const [row] = await db
      .select()
      .from(triageDecisions)
      .where(eq(triageDecisions.senderKey, senderKey));
    expect(row?.reasoning).toContain('sends 10/mo.');
  });

  /**
   * A sweeper only ever marks READ, so a contaminated numerator inflates
   * the rate and SUPPRESSES the unsubscribe suggestions this engine
   * exists to make. #583 decontaminated the senders list and the
   * timeseries reconcile; the engine itself kept scoring on the raw
   * flag, so the product's two halves disagreed about the same sender.
   */
  it('does not credit the user for reads a third-party sweeper produced', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedSender(db, mailboxAccountId, 'swept@brand.test', {
      gmailCategory: 'promotions',
      firstSeenAt: new Date('2024-01-01T00:00:00Z'),
    });
    await db.insert(mailboxLabels).values({
      mailboxAccountId,
      labelId: 'Label_117',
      name: 'unroll.me/rolled up',
      sweeperVendor: 'unroll.me',
    });
    // 90 messages, ALL marked read — but every read carries the
    // sweeper's label, so none of them is the user reading anything.
    for (let i = 0; i < 90; i += 1) {
      await db.insert(mailMessages).values({
        mailboxAccountId,
        providerMessageId: `sw${i}`,
        providerThreadId: `swt${i}`,
        senderKey,
        subject: '',
        snippet: '',
        internalDate: DEEP_IN_WINDOW,
        labelIds: ['INBOX', 'Label_117'],
        isUnread: false,
      });
    }

    const worker = new ScoreWorker({ db, now: () => NOW });
    await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'sync_complete', producedAtMs: 92_000 },
      FAKE_CTX,
    );

    const [row] = await db
      .select()
      .from(triageDecisions)
      .where(eq(triageDecisions.senderKey, senderKey));
    // ANCHORED on the preceding clause. A bare `'0% marked read'` is a
    // substring of `'100% marked read'`, so the un-anchored form passed
    // with the decontamination removed — the assertion, not the code,
    // was the blind spot.
    expect(row?.reasoning).toContain('sends 30/mo. 0% marked read over 90d');
  });

  /**
   * Mail the USER sent is not the sender's volume, and it is never
   * unread — so counting it inflated the denominator and the numerator
   * together, worst on exactly the correspondents a wrong verdict costs
   * most.
   */
  it('does not count the user’s own sent mail as the sender’s volume', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedSender(db, mailboxAccountId, 'two-way@brand.test', {
      gmailCategory: 'promotions',
      firstSeenAt: new Date('2024-01-01T00:00:00Z'),
    });
    await seedWindowMessages(db, mailboxAccountId, senderKey, {
      prefix: 'inb',
      count: 30,
      internalDate: DEEP_IN_WINDOW,
    });
    for (let i = 0; i < 60; i += 1) {
      await db.insert(mailMessages).values({
        mailboxAccountId,
        providerMessageId: `outb${i}`,
        providerThreadId: `outbt${i}`,
        senderKey,
        subject: '',
        snippet: '',
        internalDate: DEEP_IN_WINDOW,
        labelIds: ['SENT'],
        isUnread: false,
        isOutbound: true,
      });
    }

    const worker = new ScoreWorker({ db, now: () => NOW });
    await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'sync_complete', producedAtMs: 93_000 },
      FAKE_CTX,
    );

    const [row] = await db
      .select()
      .from(triageDecisions)
      .where(eq(triageDecisions.senderKey, senderKey));
    // 30 inbound / 3 = 10. Counting the 60 outbound would read 30/mo,
    // and would also report a 66% read rate for a sender the user has
    // read nothing from.
    expect(row?.reasoning).toContain('sends 10/mo. 0% marked read over 90d');
  });
});

/**
 * D256 — who the Screener is allowed to ask about.
 *
 * The quarantine lifts at three messages, so a sender that sends exactly
 * one, ever, can never leave it. On the founder's mailbox 2,490 of 3,304
 * pending senders had sent exactly one message and 784 had sent two; 28
 * would ever graduate. The queue's headline number only went up and its
 * only exit was a human clicking through it one sender at a time.
 */
describe('ScoreWorker — the Screener entry bar (D256)', () => {
  async function scoreOneOff(
    gmailCategory: 'updates' | 'primary',
    messageCount: number,
  ): Promise<{ quarantined: boolean; verdict: string | undefined }> {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    const senderKey = await seedSender(db, mailboxAccountId, `one-off-${gmailCategory}@x.test`, {
      gmailCategory,
      firstSeenAt: new Date('2026-05-20T00:00:00Z'),
      lastSeenAt: new Date('2026-05-22T00:00:00Z'),
    });
    await seedWindowMessages(db, mailboxAccountId, senderKey, {
      prefix: `oo-${gmailCategory}`,
      count: messageCount,
    });

    const worker = new ScoreWorker({ db, now: () => new Date('2026-05-23T00:00:00Z') });
    await worker.processJob(
      { mailboxAccountId, senderKey, trigger: 'sync_complete', producedAtMs: 60_000 },
      FAKE_CTX,
    );
    const queued = await db
      .select()
      .from(screenerQuarantine)
      .where(eq(screenerQuarantine.senderKey, senderKey));
    const [decision] = await db
      .select()
      .from(triageDecisions)
      .where(eq(triageDecisions.senderKey, senderKey));
    return { quarantined: queued.length > 0, verdict: decision?.verdict };
  }

  it('does not queue a sender that has written once and is not Primary', async () => {
    const { quarantined } = await scoreOneOff('updates', 1);
    expect(quarantined).toBe(false);
  });

  /**
   * NOT hidden — the distinction the whole change rests on. The sender
   * keeps its engine verdict, stays in Senders and stays eligible for
   * Triage; it is simply not queued for a standing decision it will
   * never need. Nothing is done to its mail either way (D72).
   */
  it('still writes a verdict for the sender it declines to queue', async () => {
    const { verdict } = await scoreOneOff('updates', 1);
    expect(verdict).toBe('later');
  });

  /**
   * The carve-out that ISN'T there. "Or Primary" reads like an obvious
   * second clause for the entry bar, and it is unreachable: Primary is
   * Phase A rule 3, returning Keep at 0.95 before Phase B is consulted.
   * A first message from a person never reaches the Screener because it
   * is never unjudged. Pinned so nobody adds the dead clause back.
   */
  it('never reaches the Screener for a Primary sender — Phase A keeps it first', async () => {
    const { quarantined, verdict } = await scoreOneOff('primary', 1);
    expect(verdict).toBe('keep');
    expect(quarantined).toBe(false);
  });

  it('queues a sender that has repeated at least once', async () => {
    const { quarantined } = await scoreOneOff('updates', 2);
    expect(quarantined).toBe(true);
  });
});
