import {
  mailboxAccounts,
  mailMessages,
  outboxEvents,
  providerSyncState,
  senders,
  triageDecisions,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { TOPICS } from '@declutrmail/events';
import { beforeEach, describe, expect, it } from 'vitest';

import { PASSTHROUGH_MAILBOX_LOCK } from './label-action.worker.js';
import { OutboxPublisher } from './outbox-publisher.js';
import type { ReasoningLlmPort } from './reasoning.js';
import { ScoreWorker, type ScoreJobData, type ScoreWorkerDeps } from './score.worker.js';
import { SenderIndexSweepWorker } from './sender-index-sweep.worker.js';
import type { WorkerContext } from './worker-context.js';

/**
 * The whole correction, as a user would meet it: a sender kept at 95%
 * "because Gmail puts them in your Primary inbox" when none of its mail
 * carries a Primary label. The nightly sweep recounts its tab, hands the
 * sender to the score worker, and the stored sentence must not survive —
 * including when the NEW verdict is still Keep, which the explanation
 * reuse (same verdict + unexpired → reuse) would otherwise let through.
 */
const CTX = { attempt: 1, jobId: 'j' } as WorkerContext;
// Real time: the sweep's SQL and the score worker must share one clock.
const NOW = new Date();
const DAY = 86_400_000;
const PRIMARY_SENTENCE = 'Kept because Gmail puts them in your Primary inbox.';

describe('Gmail tab recount → re-score', () => {
  let db: ScoreWorkerDeps['db'];
  let mailboxAccountId: string;
  let seq = 0;

  beforeEach(async () => {
    db = (await freshTestDb()) as unknown as ScoreWorkerDeps['db'];
    const [ws] = await db.insert(workspaces).values({ name: 'W' }).returning({ id: workspaces.id });
    const [user] = await db
      .insert(users)
      .values({ workspaceId: ws!.id, email: 'o@ex.com' })
      .returning({ id: users.id });
    const [mb] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: ws!.id,
        userId: user!.id,
        provider: 'gmail',
        providerAccountId: 'o@ex.com',
      })
      .returning({ id: mailboxAccounts.id });
    mailboxAccountId = mb!.id;
    await db.insert(providerSyncState).values({ mailboxAccountId, readinessStatus: 'ready' });
  });

  /** A sender the old default filed under Primary, with an unexpired Primary explanation. */
  async function seedGuessedPrimary(
    senderKey: string,
    messages: { labelIds: string[]; read: boolean }[],
  ): Promise<void> {
    await db.insert(senders).values({
      mailboxAccountId,
      senderKey,
      displayName: senderKey,
      email: `${senderKey}@ex.com`,
      domain: 'ex.com',
      gmailCategory: 'primary',
      firstSeenAt: new Date(NOW.getTime() - 400 * DAY),
      lastSeenAt: new Date(NOW.getTime() - 2 * DAY),
    });
    for (const m of messages) {
      seq += 1;
      await db.insert(mailMessages).values({
        mailboxAccountId,
        providerMessageId: `m${seq}`,
        providerThreadId: `t${seq}`,
        senderKey,
        subject: '',
        snippet: '',
        internalDate: new Date(NOW.getTime() - 10 * DAY),
        labelIds: m.labelIds,
        isUnread: !m.read,
        isOutbound: false,
      });
    }
    await db.insert(triageDecisions).values({
      mailboxAccountId,
      senderKey,
      verdict: 'keep',
      confidence: '0.95',
      reasoning: PRIMARY_SENTENCE,
      generatedBy: 'llm_haiku',
      producedAt: new Date(NOW.getTime() - DAY),
      expiresAt: new Date(NOW.getTime() + 6 * DAY),
    });
  }

  async function sweepThenRescore(llm: ReasoningLlmPort) {
    const jobs: ScoreJobData[] = [];
    await new SenderIndexSweepWorker({
      db: db as never,
      lock: PASSTHROUGH_MAILBOX_LOCK,
      onSendersRecategorized: async (mb, senderKeys) => {
        jobs.push({
          mailboxAccountId: mb,
          senderKeys,
          trigger: 'signal_change',
          producedAtMs: NOW.getTime(),
        });
      },
    }).processJob({ scheduledAtMinute: '2026-09-26T03:00' }, CTX);
    const scorer = new ScoreWorker({ db, llm, now: () => NOW, outbox: new OutboxPublisher() });
    for (const job of jobs) await scorer.processJob(job, CTX);
    return jobs;
  }

  async function decisionOf(senderKey: string) {
    const rows = await db.select().from(triageDecisions);
    return rows.find((r) => r.senderKey === senderKey)!;
  }

  it('an unlabelled sender loses the Primary Keep and its Primary sentence', async () => {
    await seedGuessedPrimary('newsletter', [
      { labelIds: ['INBOX'], read: false },
      { labelIds: ['INBOX'], read: false },
      { labelIds: ['INBOX'], read: false },
    ]);
    const jobs = await sweepThenRescore({ explain: async () => 'Fresh explanation.' });

    expect(jobs).toHaveLength(1);
    const d = await decisionOf('newsletter');
    expect(d.confidence).not.toBe('0.95');
    // Whichever writes the new sentence — the model, or the template when
    // no explanation is bought for this sender — it is not the old claim.
    expect(d.reasoning).not.toMatch(/primary/i);
  });

  it('rewrites the sentence even when the new verdict is still Keep', async () => {
    // Read every message: rule 5 ("you open more than half") keeps it.
    // Same verdict — the reuse path would have kept the Primary sentence
    // if the recount had not expired the decision.
    await seedGuessedPrimary('friend', [
      { labelIds: ['INBOX'], read: true },
      { labelIds: ['INBOX'], read: true },
      { labelIds: ['INBOX'], read: true },
    ]);
    await sweepThenRescore({ explain: async () => 'Kept because you read what they send.' });

    const d = await decisionOf('friend');
    expect(d.verdict).toBe('keep');
    expect(d.reasoning).not.toMatch(/primary/i);
  });

  it('re-scores the set in ONE run, so one Autopilot sweep follows', async () => {
    await seedGuessedPrimary('a', [{ labelIds: ['INBOX'], read: false }]);
    await seedGuessedPrimary('b', [{ labelIds: ['INBOX'], read: false }]);

    const jobs = await sweepThenRescore({ explain: async () => null });

    expect(jobs).toHaveLength(1);
    expect([...jobs[0]!.senderKeys!].sort()).toEqual(['a', 'b']);
    const runEvents = (await db.select().from(outboxEvents)).filter(
      (e) => e.topic === TOPICS.TRIAGE_SCORE_RUN_COMPLETED,
    );
    expect(runEvents).toHaveLength(1);
  });

  it('scores only the named senders', async () => {
    await seedGuessedPrimary('guessed', [{ labelIds: ['INBOX'], read: false }]);
    await seedGuessedPrimary('person', [{ labelIds: ['INBOX', 'CATEGORY_PERSONAL'], read: true }]);
    const before = (await decisionOf('person')).producedAt.getTime();

    await sweepThenRescore({ explain: async () => null });

    // Its tab did not move, so its decision was neither expired nor redone.
    expect((await decisionOf('person')).producedAt.getTime()).toBe(before);
  });

  it('a score job that overlapped the recount cannot bring the Primary sentence back', async () => {
    // The race: a score job that read the sender BEFORE the recount
    // committed writes its old-tab row afterwards, with a fresh expiry —
    // undoing the recount's expiry. The set job must still not reuse it.
    await seedGuessedPrimary('friend', [
      { labelIds: ['INBOX'], read: true },
      { labelIds: ['INBOX'], read: true },
      { labelIds: ['INBOX'], read: true },
    ]);
    const jobs: ScoreJobData[] = [];
    await new SenderIndexSweepWorker({
      db: db as never,
      lock: PASSTHROUGH_MAILBOX_LOCK,
      onSendersRecategorized: async (mb, senderKeys) => {
        jobs.push({
          mailboxAccountId: mb,
          senderKeys,
          trigger: 'signal_change',
          producedAtMs: NOW.getTime(),
        });
      },
    }).processJob({ scheduledAtMinute: '2026-09-26T03:00' }, CTX);
    // The overlapping job lands its stale row after the commit.
    await db.update(triageDecisions).set({
      reasoning: PRIMARY_SENTENCE,
      generatedBy: 'llm_haiku',
      verdict: 'keep',
      producedAt: new Date(NOW.getTime() - 60_000),
      expiresAt: new Date(NOW.getTime() + 6 * DAY),
    });

    const scorer = new ScoreWorker({
      db,
      llm: { explain: async () => 'Kept because you read what they send.' },
      now: () => NOW,
    });
    for (const job of jobs) await scorer.processJob(job, CTX);

    const d = await decisionOf('friend');
    expect(d.verdict).toBe('keep');
    expect(d.reasoning).not.toMatch(/primary/i);
  });

  it('refuses an empty set instead of scoring the whole mailbox', async () => {
    await seedGuessedPrimary('a', [{ labelIds: ['INBOX'], read: false }]);
    const before = (await decisionOf('a')).producedAt.getTime();

    await expect(
      new ScoreWorker({ db, now: () => NOW }).processJob(
        { mailboxAccountId, senderKeys: [], trigger: 'signal_change', producedAtMs: NOW.getTime() },
        CTX,
      ),
    ).rejects.toThrow(/empty senderKeys/);
    expect((await decisionOf('a')).producedAt.getTime()).toBe(before);
  });

  it('a set job never shares an idempotency key with a sweep or a single sender', () => {
    const key = (payload: ScoreJobData) =>
      (
        new ScoreWorker({ db }) as unknown as {
          getIdempotencyKey: (p: ScoreJobData) => string;
        }
      ).getIdempotencyKey(payload);
    const base = { mailboxAccountId, trigger: 'signal_change' as const, producedAtMs: 7 };

    const keys = [
      key({ ...base, senderKeys: ['a', 'b'] }),
      key(base),
      key({ ...base, senderKey: 'a' }),
    ];

    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).toBe(`${mailboxAccountId}:subset:7`);
  });
});
