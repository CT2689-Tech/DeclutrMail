import { mailMessages, schema, senderPolicies, senders, senderTimeseries } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { and, eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as protection from './automatic-protection.js';
import { PASSTHROUGH_MAILBOX_LOCK } from './label-action.worker.js';
import {
  MAILBOX_BATCH_SIZE,
  SenderIndexSweepWorker,
  type SenderIndexSweepJobData,
} from './sender-index-sweep.worker.js';
import type { WorkerContext } from './worker-context.js';

/**
 * The unscoped half of the derived sender index.
 *
 * The per-push path is now SCOPED to the senders a Pub/Sub push
 * touched, which cannot see the two clock-driven protection rules (a
 * star or an IMPORTANT count ageing past a year) and no longer
 * reconciles `sender_timeseries` at all. This worker is what covers
 * both, so its coverage is load-bearing for D245 — not a nice-to-have.
 */
type Db = ReturnType<typeof drizzle<typeof schema>>;

const CTX: WorkerContext = { attempt: 1, jobId: 'sweep-1' } as WorkerContext;
const RECENT = new Date(Date.now() - 30 * 86_400_000);
const LONG_AGO = new Date(Date.now() - 400 * 86_400_000);
const MONTH = '2026-08-01';

describe('SenderIndexSweepWorker', () => {
  let db: Db;
  let mailboxId: string;

  async function seedMailbox(readiness: 'ready' | 'queued' = 'ready'): Promise<string> {
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'W' })
      .returning({ id: schema.workspaces.id });
    const [user] = await db
      .insert(schema.users)
      .values({ workspaceId: ws!.id, email: `o-${readiness}-${Math.abs(Date.now() % 1e6)}@ex.com` })
      .returning({ id: schema.users.id });
    const [mb] = await db
      .insert(schema.mailboxAccounts)
      .values({
        workspaceId: ws!.id,
        userId: user!.id,
        provider: 'gmail',
        providerAccountId: `acct-${readiness}-${Math.abs(Date.now() % 1e6)}`,
        status: 'active',
      })
      .returning({ id: schema.mailboxAccounts.id });
    await db
      .insert(schema.providerSyncState)
      .values({ mailboxAccountId: mb!.id, readinessStatus: readiness });
    return mb!.id;
  }

  function run(
    enqueueContinuation: (payload: SenderIndexSweepJobData) => Promise<void> = async () => {},
  ) {
    return new SenderIndexSweepWorker({
      db: db as never,
      lock: PASSTHROUGH_MAILBOX_LOCK,
      enqueueContinuation,
    }).processJob({ scheduledAtMinute: '2026-08-24T03:00' }, CTX);
  }

  beforeEach(async () => {
    db = await freshTestDb();
    mailboxId = await seedMailbox();
  });

  /** Seed a sweep-authored protection so retirement has something to retire. */
  async function seedProtection(
    senderKey: string,
    reason: 'replied' | 'starred' | 'gmail_important',
  ): Promise<void> {
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey,
      policyType: 'keep',
      isProtected: true,
      protectionReason: reason,
      protectionSetAt: LONG_AGO,
    });
  }

  async function policyFor(senderKey: string) {
    const [row] = await db
      .select({
        isProtected: senderPolicies.isProtected,
        reason: senderPolicies.protectionReason,
        setAt: senderPolicies.protectionSetAt,
      })
      .from(senderPolicies)
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxId),
          eq(senderPolicies.senderKey, senderKey),
        ),
      );
    return row;
  }

  it('retires a protection whose star has aged past a year', async () => {
    // THE reason this worker exists, and for one commit it did not work.
    //
    // This test shipped asserting `policy` was `undefined` while seeding
    // NO `sender_policies` row at all — so it proved the sweep does not
    // CREATE a protection from a stale star, and said nothing about
    // whether it RETIRES one. It passed for the entire life of the
    // defect it is named for. The demote statement only handled
    // `gmail_important` on a non-Primary sender; a `starred` protection
    // with a two-year-old star survived every sweep, which is the exact
    // D245 §2.6 violation this file claims to prevent. Caught by review,
    // 2026-08-24, not by this test.
    await db.insert(senders).values({
      mailboxAccountId: mailboxId,
      senderKey: 'stale-star',
      email: 'stale@ex.com',
      domain: 'ex.com',
      gmailCategory: 'promotions',
      firstSeenAt: LONG_AGO,
      lastSeenAt: LONG_AGO,
    });
    await db.insert(mailMessages).values({
      mailboxAccountId: mailboxId,
      providerMessageId: 'old-star',
      providerThreadId: 't-old-star',
      senderKey: 'stale-star',
      subject: 's',
      snippet: '',
      internalDate: LONG_AGO,
      labelIds: ['INBOX', 'STARRED'],
      isUnread: false,
      isOutbound: false,
    });
    await seedProtection('stale-star', 'starred');

    await run();

    const policy = await policyFor('stale-star');
    expect(policy?.isProtected).toBe(false);
    expect(policy?.reason).toBeNull();
  });

  it('retires a replied protection once the reply count decays below 3', async () => {
    // `wrote_to_count` is a stored counter that the senders index can
    // revise downward. Nothing in Gmail announces it, so only this sweep
    // can notice — the second of the three clock-driven cases the
    // narrow demote could not reach.
    await db.insert(senders).values({
      mailboxAccountId: mailboxId,
      senderKey: 'quiet-friend',
      email: 'qf@ex.com',
      domain: 'ex.com',
      gmailCategory: 'promotions',
      wroteToCount: 1,
      firstSeenAt: LONG_AGO,
      lastSeenAt: RECENT,
    });
    await db.insert(mailMessages).values({
      mailboxAccountId: mailboxId,
      providerMessageId: 'qf1',
      providerThreadId: 't-qf1',
      senderKey: 'quiet-friend',
      subject: 's',
      snippet: '',
      internalDate: RECENT,
      labelIds: ['INBOX'],
      isUnread: false,
      isOutbound: false,
    });
    await seedProtection('quiet-friend', 'replied');

    await run();

    expect((await policyFor('quiet-friend'))?.isProtected).toBe(false);
  });

  it('corrects a stored reason that is no longer the true one', async () => {
    // D245 requires the reason SHOWN to be true, not merely that some
    // reason holds. A sender whose star aged out but who is now replied-to
    // is still protected — but "because you starred it" is a false
    // statement, so the reason has to move to `replied`.
    await db.insert(senders).values({
      mailboxAccountId: mailboxId,
      senderKey: 'now-replied',
      email: 'nr@ex.com',
      domain: 'ex.com',
      gmailCategory: 'promotions',
      wroteToCount: 5,
      firstSeenAt: LONG_AGO,
      lastSeenAt: RECENT,
    });
    await db.insert(mailMessages).values({
      mailboxAccountId: mailboxId,
      providerMessageId: 'nr1',
      providerThreadId: 't-nr1',
      senderKey: 'now-replied',
      subject: 's',
      snippet: '',
      internalDate: LONG_AGO,
      labelIds: ['INBOX', 'STARRED'],
      isUnread: false,
      isOutbound: false,
    });
    await seedProtection('now-replied', 'starred');

    await run();

    const policy = await policyFor('now-replied');
    // Demoted by the first statement, re-protected by the upsert in the
    // same transaction under its CURRENT reason.
    expect(policy?.isProtected).toBe(true);
    expect(policy?.reason).toBe('replied');
  });

  it('leaves a still-true protection completely alone', async () => {
    // The churn guard. `IS DISTINCT FROM` must not fire on an UNCHANGED
    // reason — an `IS NULL` test would demote-and-reprotect every
    // protected sender every night, resetting `protection_set_at` and
    // making "protected since" meaningless.
    await db.insert(senders).values({
      mailboxAccountId: mailboxId,
      senderKey: 'fresh-star',
      email: 'fs@ex.com',
      domain: 'ex.com',
      gmailCategory: 'promotions',
      firstSeenAt: LONG_AGO,
      lastSeenAt: RECENT,
    });
    await db.insert(mailMessages).values({
      mailboxAccountId: mailboxId,
      providerMessageId: 'fs1',
      providerThreadId: 't-fs1',
      senderKey: 'fresh-star',
      subject: 's',
      snippet: '',
      internalDate: RECENT,
      labelIds: ['INBOX', 'STARRED'],
      isUnread: false,
      isOutbound: false,
    });
    await seedProtection('fresh-star', 'starred');

    await run();

    const policy = await policyFor('fresh-star');
    expect(policy?.isProtected).toBe(true);
    expect(policy?.reason).toBe('starred');
    // Untouched, not demoted-and-restored.
    expect(policy?.setAt?.getTime()).toBe(LONG_AGO.getTime());
  });

  it('never withdraws a protection the USER set', async () => {
    // `user_defined` is manual agency. A sweep that could retire it
    // would silently overrule the person — the one outcome D245 rules
    // out entirely, however stale the signals look.
    await db.insert(senders).values({
      mailboxAccountId: mailboxId,
      senderKey: 'manual',
      email: 'm@ex.com',
      domain: 'ex.com',
      gmailCategory: 'promotions',
      firstSeenAt: LONG_AGO,
      lastSeenAt: LONG_AGO,
    });
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: 'manual',
      policyType: 'keep',
      isProtected: true,
      protectionReason: 'user_defined',
      protectionSetAt: LONG_AGO,
    });

    await run();

    const policy = await policyFor('manual');
    expect(policy?.isProtected).toBe(true);
    expect(policy?.reason).toBe('user_defined');
  });

  it('corrects a sender-month whose stored counters drifted', async () => {
    await db.insert(senders).values({
      mailboxAccountId: mailboxId,
      senderKey: 'drifted',
      email: 'd@ex.com',
      domain: 'ex.com',
      gmailCategory: 'primary',
      firstSeenAt: LONG_AGO,
      lastSeenAt: RECENT,
    });
    await db.insert(mailMessages).values({
      mailboxAccountId: mailboxId,
      providerMessageId: 'd1',
      providerThreadId: 't-d1',
      senderKey: 'drifted',
      subject: 's',
      snippet: '',
      internalDate: new Date('2026-08-05T00:00:00Z'),
      labelIds: ['INBOX'],
      isUnread: false,
      isOutbound: false,
    });
    // Stored counters say 9 messages, none read. The mirror holds one,
    // and it is read. This is the drift the push path used to close on
    // every push and now closes here.
    await db.insert(senderTimeseries).values({
      mailboxAccountId: mailboxId,
      senderKey: 'drifted',
      yearMonth: MONTH,
      volume: 9,
      readCount: 0,
    });

    const result = await run();

    const [row] = await db
      .select({ volume: senderTimeseries.volume, readCount: senderTimeseries.readCount })
      .from(senderTimeseries)
      .where(
        and(
          eq(senderTimeseries.mailboxAccountId, mailboxId),
          eq(senderTimeseries.senderKey, 'drifted'),
        ),
      );
    expect(row).toEqual({ volume: 1, readCount: 1 });
    expect(result.timeseriesCorrected).toBe(1);
    expect(result.mailboxesProcessed).toBe(1);
  });

  it('skips a mailbox that is not sync-ready', async () => {
    // Blind case for the eligibility query: if this swept, the
    // `readiness_status` predicate is doing nothing and the counts
    // above are not measuring what they claim.
    db = await freshTestDb();
    await seedMailbox('queued');
    expect((await run()).mailboxesProcessed).toBe(0);
  });

  it('reports the swept count on the ops line, not just in the return value', async () => {
    // THE REGRESSION THIS FILE EXISTS TO PREVENT. `worker.succeeded`
    // filters the result through `SAFE_WORKER_RESULT_KEYS`, which is a
    // denylist by omission: a key absent from it is dropped with no
    // error anywhere. This field shipped as `mailboxesSwept`, was not on
    // the list, and vanished from the log — leaving a sweep that
    // reported `durationMs` and `mailboxesFailed: 0` with no way to tell
    // a clean pass from one that swept nothing. Every assertion in this
    // file that reads the RETURN VALUE was green throughout.
    //
    // So this one reads the LOG. Asserting the producer is not asserting
    // what ops sees.
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    try {
      await new SenderIndexSweepWorker({
        db: db as never,
        lock: PASSTHROUGH_MAILBOX_LOCK,
      }).run({
        id: 'sweep-1',
        data: { scheduledAtMinute: '2026-08-24T03:00' },
        attemptsMade: 0,
      } as never);
    } finally {
      spy.mockRestore();
    }

    const succeeded = lines
      .map((l) => {
        try {
          return JSON.parse(l) as { kind?: string; result?: Record<string, unknown> };
        } catch {
          return null;
        }
      })
      .find((l) => l?.kind === 'worker.succeeded');
    expect(succeeded?.result).toHaveProperty('mailboxesProcessed');
  });

  it('bounds each job and queues a continuation rather than dropping overflow', async () => {
    for (let i = 0; i < MAILBOX_BATCH_SIZE + 2; i++) await seedMailbox();
    const enqueue = vi.fn(async (_payload: SenderIndexSweepJobData) => {});
    const result = await run(enqueue);
    expect(result.mailboxesProcessed).toBe(MAILBOX_BATCH_SIZE);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]![0].afterMailboxId).toBeTruthy();
  });

  it('continues ordered batches until every eligible mailbox is visited exactly once', async () => {
    for (let i = 0; i < MAILBOX_BATCH_SIZE + 2; i++) await seedMailbox();
    const visited: string[] = [];
    const pending: SenderIndexSweepJobData[] = [{ scheduledAtMinute: '2026-09-22T03:00' }];
    const worker = new SenderIndexSweepWorker({
      db: db as never,
      lock: {
        run: async (id, fn) => {
          visited.push(id);
          return fn();
        },
      },
      enqueueContinuation: async (payload) => {
        pending.push(payload);
      },
    });
    while (pending.length) await worker.processJob(pending.shift()!, CTX);
    expect(visited).toHaveLength(MAILBOX_BATCH_SIZE + 3);
    expect(new Set(visited).size).toBe(visited.length);
    expect(visited).toEqual([...visited].sort());
  });

  it('finishes a complete batch without another continuation', async () => {
    const enqueue = vi.fn(async (_payload: SenderIndexSweepJobData) => {});
    const result = await run(enqueue);
    expect(result.mailboxesProcessed).toBe(1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('rolls back protection changes when cancelled during the last transaction query', async () => {
    await seedProtection('expired', 'starred');
    const controller = new AbortController();
    const apply = protection.applyAutomaticProtection;
    const spy = vi
      .spyOn(protection, 'applyAutomaticProtection')
      .mockImplementation(async (...args) => {
        const result = await apply(...args);
        controller.abort(new Error('fixture deadline'));
        return result;
      });
    try {
      const worker = new SenderIndexSweepWorker({
        db: db as never,
        lock: PASSTHROUGH_MAILBOX_LOCK,
      });
      await expect(
        worker.processJob(
          { scheduledAtMinute: '2026-09-22T03:00' },
          { ...CTX, signal: controller.signal },
        ),
      ).rejects.toThrow('fixture deadline');
      expect((await policyFor('expired'))?.isProtected).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('persists the tail before failing a mailbox, so retries cannot starve later mailboxes', async () => {
    const second = await seedMailbox();
    const firstId = [mailboxId, second].sort()[0]!;
    const continuations: SenderIndexSweepJobData[] = [];
    const visited: string[] = [];
    const worker = new SenderIndexSweepWorker({
      db: db as never,
      lock: {
        run: async (id, fn) => {
          visited.push(id);
          if (id === firstId) throw new Error('boom');
          return fn();
        },
      },
      enqueueContinuation: async (payload) => {
        continuations.push(payload);
      },
    });
    await expect(worker.processJob({ scheduledAtMinute: '2026-09-22T03:00' }, CTX)).rejects.toThrow(
      /all 1 eligible/,
    );
    expect(continuations).toHaveLength(1);
    await worker.processJob(continuations[0]!, CTX);
    expect(visited).toEqual([mailboxId, second].sort());
  });
});
