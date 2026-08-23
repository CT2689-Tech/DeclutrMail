import { mailMessages, schema, senderPolicies, senders, senderTimeseries } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { and, eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PASSTHROUGH_MAILBOX_LOCK } from './label-action.worker.js';
import { SenderIndexSweepWorker } from './sender-index-sweep.worker.js';
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

  function run() {
    return new SenderIndexSweepWorker({
      db: db as never,
      lock: PASSTHROUGH_MAILBOX_LOCK,
    }).processJob({ scheduledAtMinute: '2026-08-24T03:00' }, CTX);
  }

  beforeEach(async () => {
    db = await freshTestDb();
    mailboxId = await seedMailbox();
  });

  it('retires a protection whose star has aged past a year', async () => {
    // THE reason this worker exists. No Gmail event announces the
    // passage of time, so the scoped per-push sweep can never reach
    // this sender — its evidence expired without anything happening.
    await db.insert(senders).values({
      mailboxAccountId: mailboxId,
      senderKey: 'stale-star',
      email: 'stale@ex.com',
      domain: 'ex.com',
      gmailCategory: 'primary',
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

    await run();

    const [policy] = await db
      .select({ reason: senderPolicies.protectionReason })
      .from(senderPolicies)
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxId),
          eq(senderPolicies.senderKey, 'stale-star'),
        ),
      );
    expect(policy).toBeUndefined();
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

  it('keeps sweeping after one mailbox throws, and fails only when all do', async () => {
    const second = await seedMailbox();
    const lock = {
      run: vi.fn(async (mailboxAccountId: string, fn: () => Promise<unknown>) => {
        if (mailboxAccountId === second) throw new Error('boom');
        return fn();
      }),
    };
    const worker = new SenderIndexSweepWorker({ db: db as never, lock: lock as never });
    const result = await worker.processJob({ scheduledAtMinute: '2026-08-24T03:00' }, CTX);
    expect(result).toMatchObject({ mailboxesProcessed: 1, mailboxesFailed: 1 });

    const allFail = new SenderIndexSweepWorker({
      db: db as never,
      lock: { run: () => Promise.reject(new Error('boom')) } as never,
    });
    await expect(
      allFail.processJob({ scheduledAtMinute: '2026-08-24T03:00' }, CTX),
    ).rejects.toThrow(/all 2 eligible mailboxes/);
  });
});
