import {
  accountDeletionRequests,
  mailboxDataDeletionRequests,
  mailMessages,
  providerSyncState,
  schema,
  senderPolicies,
  senders,
  senderTimeseries,
  triageDecisions,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { and, eq, inArray } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as protection from './automatic-protection.js';
import * as gmailCategory from './gmail-category.js';
import { PASSTHROUGH_MAILBOX_LOCK } from './label-action.worker.js';
import { OutboxPublisher } from './outbox-publisher.js';
import {
  MAILBOX_BATCH_SIZE,
  rescoreJobId,
  SenderIndexSweepWorker,
  type SenderIndexSweepJobData,
  type SenderIndexSweepResult,
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
/** For tests that are not about re-scoring — the hook is required. */
const NO_RESCORE = async () => {};
/** Lock holds one mailbox takes per sweep: timeseries, then recount + protection. */
const HOLDS_PER_MAILBOX = 2;

/** Run `body` with one console stream captured; returns its JSON lines. */
async function captureLines(
  stream: 'log' | 'error',
  body: () => Promise<unknown>,
): Promise<Array<Record<string, unknown>>> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, stream).mockImplementation((l: unknown) => {
    lines.push(String(l));
  });
  try {
    await body();
  } finally {
    spy.mockRestore();
  }
  return lines.flatMap((l) => {
    try {
      return [JSON.parse(l) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

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
      onSendersRecategorized: NO_RESCORE,
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

  describe('Gmail tab recount (mig 0079)', () => {
    /**
     * A sender written by the old "no tab label → primary" default, with
     * the stored decision a recount has to invalidate.
     */
    async function seedGuessedPrimary(senderKey: string, labelSets: string[][]): Promise<void> {
      await db.insert(triageDecisions).values({
        mailboxAccountId: mailboxId,
        senderKey,
        verdict: 'keep',
        confidence: '0.95',
        reasoning: 'Kept because Gmail puts them in your Primary inbox.',
        generatedBy: 'llm_haiku',
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      await db.insert(senders).values({
        mailboxAccountId: mailboxId,
        senderKey,
        email: `${senderKey}@ex.com`,
        domain: 'ex.com',
        gmailCategory: 'primary',
        firstSeenAt: LONG_AGO,
        lastSeenAt: RECENT,
      });
      await db.insert(mailMessages).values(
        labelSets.map((labelIds, i) => ({
          mailboxAccountId: mailboxId,
          providerMessageId: `${senderKey}-${i}`,
          providerThreadId: `t-${senderKey}-${i}`,
          senderKey,
          subject: 's',
          snippet: '',
          internalDate: RECENT,
          labelIds,
          isUnread: false,
          isOutbound: false,
        })),
      );
    }

    async function categoryOf(senderKey: string) {
      const [row] = await db
        .select({ c: senders.gmailCategory })
        .from(senders)
        .where(and(eq(senders.mailboxAccountId, mailboxId), eq(senders.senderKey, senderKey)));
      return row?.c;
    }

    it('corrects a Primary no label backs, then asks for exactly those senders to be re-scored', async () => {
      await seedGuessedPrimary('guessed', [['INBOX'], ['INBOX']]);
      await seedGuessedPrimary('person', [['INBOX', 'CATEGORY_PERSONAL']]);
      const rescored: [string, readonly string[]][] = [];

      const result = await new SenderIndexSweepWorker({
        db: db as never,
        lock: PASSTHROUGH_MAILBOX_LOCK,
        onSendersRecategorized: async (mb, keys) => {
          rescored.push([mb, keys]);
        },
      }).processJob({ scheduledAtMinute: '2026-09-26T03:00' }, CTX);

      expect(await categoryOf('guessed')).toBe('unknown');
      expect(await categoryOf('person')).toBe('primary');
      expect(result.categoriesCorrected).toBe(1);
      expect(result.rescoresRequested).toBe(1);
      expect(rescored).toEqual([[mailboxId, ['guessed']]]);
    });

    it('does not re-score a corrected sender that was never scored — there is no claim to replace', async () => {
      await db.insert(senders).values({
        mailboxAccountId: mailboxId,
        senderKey: 'never-scored',
        email: 'ns@ex.com',
        domain: 'ex.com',
        gmailCategory: 'primary',
        firstSeenAt: LONG_AGO,
        lastSeenAt: RECENT,
      });
      const onSendersRecategorized = vi.fn(async () => {});

      const result = await new SenderIndexSweepWorker({
        db: db as never,
        lock: PASSTHROUGH_MAILBOX_LOCK,
        onSendersRecategorized,
      }).processJob({ scheduledAtMinute: '2026-09-26T03:00' }, CTX);

      expect(result.categoriesCorrected).toBe(1);
      expect(onSendersRecategorized).not.toHaveBeenCalled();
    });

    it('releases an importance protection that only a guessed Primary granted — in the same pass', async () => {
      // Order matters: protection reads `gmail_category = 'primary'`, so
      // the recount has to land first or the stale protection survives
      // until the next sweep.
      await seedGuessedPrimary('important-unlabelled', [
        ['INBOX', 'IMPORTANT'],
        ['INBOX', 'IMPORTANT'],
        ['INBOX', 'IMPORTANT'],
      ]);
      await seedProtection('important-unlabelled', 'gmail_important');

      let result: SenderIndexSweepResult | undefined;
      const lines = await captureLines('log', async () => {
        result = await run();
      });

      const policy = await policyFor('important-unlabelled');
      expect(policy?.isProtected).toBe(false);
      expect(policy?.reason).toBeNull();
      // Withdrawn safety state is counted and logged by the reason it had —
      // never silent, and never naming the sender.
      expect(result?.protectionsReleased).toBe(1);
      const released = lines.find((l) => l.kind === 'automatic_protection.released');
      expect(released).toMatchObject({
        worker: 'SenderIndexSweepWorker',
        released: 1,
        byReason: { gmail_important: 1 },
      });
      // Counts only: exactly these fields, so a field added later has to
      // come through this test.
      expect(Object.keys(released!).sort()).toEqual([
        'byReason',
        'kind',
        'level',
        'mailboxRef',
        'released',
        'severity',
        'worker',
      ]);
      expect(JSON.stringify(released)).not.toContain('important-unlabelled');
    });

    it('keeps an importance protection earned on real Primary mail that no longer has a majority', async () => {
      // The narrowed release. Primary tied with Updates reads `unknown`
      // after the recount, but this protection was earned on mail Gmail
      // itself labelled Primary — only a Primary no label ever backed is
      // withdrawn.
      await seedGuessedPrimary('split', [
        ['INBOX', 'IMPORTANT', 'CATEGORY_PERSONAL'],
        ['INBOX', 'IMPORTANT', 'CATEGORY_PERSONAL'],
        ['INBOX', 'IMPORTANT', 'CATEGORY_UPDATES'],
        ['INBOX', 'IMPORTANT', 'CATEGORY_UPDATES'],
      ]);
      await seedProtection('split', 'gmail_important');

      const result = await run();

      expect(await categoryOf('split')).toBe('unknown');
      const policy = await policyFor('split');
      expect(policy?.isProtected).toBe(true);
      expect(policy?.reason).toBe('gmail_important');
      expect(policy?.setAt?.getTime()).toBe(LONG_AGO.getTime());
      expect(result.protectionsReleased).toBe(0);
    });

    it('keeps an importance protection that real Primary mail backs', async () => {
      await seedGuessedPrimary('important-primary', [
        ['INBOX', 'IMPORTANT', 'CATEGORY_PERSONAL'],
        ['INBOX', 'IMPORTANT', 'CATEGORY_PERSONAL'],
        ['INBOX', 'IMPORTANT', 'CATEGORY_PERSONAL'],
      ]);
      await seedProtection('important-primary', 'gmail_important');

      await run();

      const policy = await policyFor('important-primary');
      expect(policy?.isProtected).toBe(true);
      expect(policy?.reason).toBe('gmail_important');
    });

    it('asks for no re-score when no tab moved', async () => {
      await seedGuessedPrimary('person', [['INBOX', 'CATEGORY_PERSONAL']]);
      const onSendersRecategorized = vi.fn(async () => {});

      const result = await new SenderIndexSweepWorker({
        db: db as never,
        lock: PASSTHROUGH_MAILBOX_LOCK,
        onSendersRecategorized,
      }).processJob({ scheduledAtMinute: '2026-09-26T03:00' }, CTX);

      expect(result.categoriesCorrected).toBe(0);
      expect(onSendersRecategorized).not.toHaveBeenCalled();
    });

    it('a failed re-score request is captured, counted, and asked for again on the next sweep', async () => {
      await seedGuessedPrimary('guessed', [['INBOX']]);
      const captured: string[] = [];
      const observer = {
        captureFailure() {},
        captureBackgroundFailure(_e: Error, c: { kind: string }) {
          captured.push(c.kind);
        },
        recordBackgroundNotice() {},
      };
      const requests: (readonly string[])[] = [];
      let fail = true;
      const worker = new SenderIndexSweepWorker({
        db: db as never,
        lock: PASSTHROUGH_MAILBOX_LOCK,
        onSendersRecategorized: async (_mb, keys) => {
          if (fail) throw new Error('redis down');
          requests.push(keys);
        },
      });
      worker.setObserver(observer);

      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      let first;
      try {
        first = await worker.processJob({ scheduledAtMinute: '2026-09-26T03:00' }, CTX);
      } finally {
        spy.mockRestore();
      }

      // The correction committed; the miss reached the observer and the ops line.
      expect(await categoryOf('guessed')).toBe('unknown');
      expect(first.mailboxesProcessed).toBe(1);
      expect(first.rescoresNotRequested).toBe(1);
      expect(captured).toEqual(['sender_index_sweep.rescore_request_failed']);

      // Next sweep: the tab no longer moves, but the sender is still
      // marked stale, so it is asked for again.
      fail = false;
      const second = await worker.processJob({ scheduledAtMinute: '2026-09-27T03:00' }, CTX);
      expect(second.categoriesCorrected).toBe(0);
      expect(second.rescoresRequested).toBe(1);
      expect(requests).toEqual([['guessed']]);
    });

    it('corrects a disconnected mailbox — the export prints its tab — without asking for a re-score', async () => {
      await seedGuessedPrimary('guessed', [['INBOX']]);
      await db
        .update(schema.mailboxAccounts)
        .set({ status: 'disconnected' })
        .where(eq(schema.mailboxAccounts.id, mailboxId));
      const onSendersRecategorized = vi.fn(async () => {});

      const result = await new SenderIndexSweepWorker({
        db: db as never,
        lock: PASSTHROUGH_MAILBOX_LOCK,
        onSendersRecategorized,
      }).processJob({ scheduledAtMinute: '2026-09-26T03:00' }, CTX);

      expect(result.categoriesCorrected).toBe(1);
      expect(await categoryOf('guessed')).toBe('unknown');
      expect(onSendersRecategorized).not.toHaveBeenCalled();
    });

    it.each([
      ['an account deletion is in its undo window', 'account-deletion'],
      ['a mailbox data deletion is pending', 'data-deletion'],
      ['the Gmail grant needs reconnecting', 'reconnect'],
    ] as const)(
      'corrects the tab but asks for no re-score while %s — a re-score wakes Autopilot',
      async (_label, state) => {
        await seedGuessedPrimary('guessed', [['INBOX']]);
        if (state === 'account-deletion') {
          const [owner] = await db
            .select({ userId: schema.mailboxAccounts.userId })
            .from(schema.mailboxAccounts)
            .where(eq(schema.mailboxAccounts.id, mailboxId));
          await db.insert(accountDeletionRequests).values({
            userId: owner!.userId,
            effectiveAt: new Date(Date.now() + 7 * 86_400_000),
            basis: 'flat-grace',
            status: 'pending',
          });
        } else if (state === 'data-deletion') {
          await db.insert(mailboxDataDeletionRequests).values({ mailboxAccountId: mailboxId });
        } else {
          await db
            .update(providerSyncState)
            .set({
              lastIncrementalErrorAt: new Date(),
              lastIncrementalErrorCode: 'InvalidGrantError',
            })
            .where(eq(providerSyncState.mailboxAccountId, mailboxId));
        }
        const onSendersRecategorized = vi.fn(async () => {});

        const result = await new SenderIndexSweepWorker({
          db: db as never,
          lock: PASSTHROUGH_MAILBOX_LOCK,
          onSendersRecategorized,
        }).processJob({ scheduledAtMinute: '2026-09-26T03:00' }, CTX);

        expect(result.categoriesCorrected).toBe(1);
        expect(await categoryOf('guessed')).toBe('unknown');
        expect(onSendersRecategorized).not.toHaveBeenCalled();
        // Still marked, so the first sweep after the mailbox is eligible
        // again asks for it.
        expect(await gmailCategory.sendersAwaitingRescore(db as never, mailboxId)).toEqual([
          'guessed',
        ]);
      },
    );

    it('re-reads eligibility after the holds: a deletion requested mid-sweep still stops the re-score', async () => {
      await seedGuessedPrimary('guessed', [['INBOX']]);
      const [owner] = await db
        .select({ userId: schema.mailboxAccounts.userId })
        .from(schema.mailboxAccounts)
        .where(eq(schema.mailboxAccounts.id, mailboxId));
      let holds = 0;
      const onSendersRecategorized = vi.fn(async () => {});
      const worker = new SenderIndexSweepWorker({
        db: db as never,
        lock: {
          run: async (_id, fn) => {
            const out = await fn();
            holds += 1;
            if (holds === HOLDS_PER_MAILBOX) {
              // The user asks to delete their account while the sweep
              // holds the lock.
              await db.insert(accountDeletionRequests).values({
                userId: owner!.userId,
                effectiveAt: new Date(Date.now() + 7 * 86_400_000),
                basis: 'flat-grace',
                status: 'pending',
              });
            }
            return out;
          },
        },
        onSendersRecategorized,
      });

      const result = await worker.processJob({ scheduledAtMinute: '2026-09-27T03:00' }, CTX);

      expect(result.categoriesCorrected).toBe(1);
      expect(result.rescoresRequested).toBe(0);
      expect(onSendersRecategorized).not.toHaveBeenCalled();
    });

    it('asks under one job id per sweep tick, so a late retry cannot queue a second re-score', async () => {
      // A sweep job can commit and still fail its 60 s budget (two lock
      // waits of up to 45 s each); BullMQ then retries the same payload.
      await seedGuessedPrimary('guessed', [['INBOX']]);
      const asks: string[] = [];
      const worker = new SenderIndexSweepWorker({
        db: db as never,
        lock: PASSTHROUGH_MAILBOX_LOCK,
        onSendersRecategorized: async (mb, _keys, sweepTick) => {
          asks.push(rescoreJobId(mb, sweepTick));
        },
      });
      const tick = { scheduledAtMinute: '2026-09-27T03:00' };

      await worker.processJob(tick, CTX);
      await worker.processJob(tick, CTX); // the retry: still marked, asks again
      await worker.processJob({ scheduledAtMinute: '2026-09-28T03:00' }, CTX);

      expect(asks).toHaveLength(3);
      expect(asks[1]).toBe(asks[0]);
      expect(asks[2]).not.toBe(asks[0]);
    });

    it('asks for at most the cap per sweep, largest senders first; the rest wait marked', async () => {
      // Sizes chosen so largest-first differs from insertion order, its
      // reverse, and key order — any of which an unordered read may return.
      const sizes = { a: 10, b: 900, c: 50, d: 500 } as const;
      for (const [senderKey, totalReceived] of Object.entries(sizes)) {
        await seedGuessedPrimary(senderKey, [['INBOX']]);
        await db
          .update(senders)
          .set({ totalReceived })
          .where(and(eq(senders.mailboxAccountId, mailboxId), eq(senders.senderKey, senderKey)));
      }
      const requests: (readonly string[])[] = [];
      const worker = new SenderIndexSweepWorker({
        db: db as never,
        lock: PASSTHROUGH_MAILBOX_LOCK,
        onSendersRecategorized: async (_mb, keys) => {
          requests.push(keys);
        },
        rescoreSetLimit: 2,
      });

      const first = await worker.processJob({ scheduledAtMinute: '2026-09-26T03:00' }, CTX);
      expect(first.rescoresRequested).toBe(2);
      expect(requests).toEqual([['b', 'd']]);

      // The score worker re-scores what it was handed (a fresh verdict — no
      // longer the Primary Keep); the remainder is still marked and goes
      // out with the next sweep.
      await db
        .update(triageDecisions)
        .set({
          verdict: 'archive',
          confidence: '0.80',
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
        })
        .where(
          and(
            eq(triageDecisions.mailboxAccountId, mailboxId),
            inArray(triageDecisions.senderKey, ['b', 'd']),
          ),
        );
      const second = await worker.processJob({ scheduledAtMinute: '2026-09-27T03:00' }, CTX);
      expect(second.rescoresRequested).toBe(2);
      expect(requests).toEqual([
        ['b', 'd'],
        ['c', 'a'],
      ]);
    });

    it('rolls the recount back with a failed protection pass; the timeseries hold still commits', async () => {
      // A tab never commits without the protection derived from it (see the
      // interleaving test below). Timeseries feeds no safety state, so it
      // keeps its own hold and survives the failure.
      await seedGuessedPrimary('guessed', [['INBOX']]);
      await db.insert(senderTimeseries).values({
        mailboxAccountId: mailboxId,
        senderKey: 'guessed',
        yearMonth: MONTH,
        volume: 9,
        readCount: 0,
      });
      const fail = vi
        .spyOn(protection, 'applyAutomaticProtection')
        .mockRejectedValue(new Error('protection broke'));
      let lines: Array<Record<string, unknown>> = [];
      try {
        lines = await captureLines('error', () =>
          expect(run()).rejects.toThrow(/failed for all 1 eligible/),
        );
      } finally {
        fail.mockRestore();
      }

      expect(await categoryOf('guessed')).toBe('primary');
      expect(await gmailCategory.sendersAwaitingRescore(db as never, mailboxId)).toEqual([]);
      const [series] = await db
        .select({ volume: senderTimeseries.volume })
        .from(senderTimeseries)
        .where(
          and(
            eq(senderTimeseries.mailboxAccountId, mailboxId),
            eq(senderTimeseries.senderKey, 'guessed'),
          ),
        );
      expect(series?.volume).not.toBe(9);
      const failure = lines.find((l) => l.kind === 'sender_index_sweep.mailbox_failed');
      expect(failure?.step).toBe('protection');
    });

    it('never commits a Primary the recount established without the protection it implies', async () => {
      // THE interleaving that matters: the Autopilot action worker takes the
      // same mailbox lock per match and checks only `is_protected`. Anything
      // queued on the lock runs between two holds, so after EVERY hold a
      // sender the recount moved into Primary, with 3+ recent Important
      // messages, must already be protected — or an approved unsubscribe
      // runs against a sender this sweep was about to protect.
      await db.insert(senders).values({
        mailboxAccountId: mailboxId,
        senderKey: 'moved-to-primary',
        email: 'moved@ex.com',
        domain: 'ex.com',
        gmailCategory: 'updates',
        firstSeenAt: LONG_AGO,
        lastSeenAt: RECENT,
      });
      await db.insert(mailMessages).values(
        [0, 1, 2].map((i) => ({
          mailboxAccountId: mailboxId,
          providerMessageId: `moved-${i}`,
          providerThreadId: `t-moved-${i}`,
          senderKey: 'moved-to-primary',
          subject: 's',
          snippet: '',
          internalDate: RECENT,
          labelIds: ['INBOX', 'IMPORTANT', 'CATEGORY_PERSONAL'],
          isUnread: false,
          isOutbound: false,
        })),
      );
      const between: Array<{ tab: string | undefined; isProtected: boolean }> = [];
      const worker = new SenderIndexSweepWorker({
        db: db as never,
        lock: {
          run: async (_id, fn) => {
            const out = await fn();
            // What a waiter on the lock would read the moment this hold ends.
            between.push({
              tab: await categoryOf('moved-to-primary'),
              isProtected: (await policyFor('moved-to-primary'))?.isProtected ?? false,
            });
            return out;
          },
        },
        onSendersRecategorized: NO_RESCORE,
      });

      await worker.processJob({ scheduledAtMinute: '2026-09-27T03:00' }, CTX);

      expect(between.at(-1)).toEqual({ tab: 'primary', isProtected: true });
      expect(between.filter((b) => b.tab === 'primary' && !b.isProtected)).toEqual([]);
    });

    it('names a failure to take the lock `lock`, not the step that ran before it', async () => {
      let acquisitions = 0;
      const worker = new SenderIndexSweepWorker({
        db: db as never,
        lock: {
          run: async (_id, fn) => {
            acquisitions += 1;
            if (acquisitions === 2) throw new Error('lock wait timed out');
            return fn();
          },
        },
        onSendersRecategorized: NO_RESCORE,
      });

      const lines = await captureLines('error', () =>
        expect(worker.processJob({ scheduledAtMinute: '2026-09-26T03:00' }, CTX)).rejects.toThrow(
          /failed for all 1 eligible/,
        ),
      );

      const failure = lines.find((l) => l.kind === 'sender_index_sweep.mailbox_failed');
      expect(failure?.step).toBe('lock');
    });

    it('names the step that failed, so a broken recount is not an anonymous failure', async () => {
      await seedGuessedPrimary('guessed', [['INBOX']]);
      const lines: string[] = [];
      const fail = vi
        .spyOn(gmailCategory, 'reconcileSenderCategories')
        .mockRejectedValue(new Error('shape drift'));
      const spy = vi.spyOn(console, 'error').mockImplementation((l: unknown) => {
        lines.push(String(l));
      });
      try {
        await expect(run()).rejects.toThrow(/failed for all 1 eligible/);
      } finally {
        spy.mockRestore();
        fail.mockRestore();
      }
      const failure = lines
        .map((l) => JSON.parse(l) as { kind?: string; step?: string; mailboxRef?: string })
        .find((l) => l.kind === 'sender_index_sweep.mailbox_failed');
      expect(failure?.step).toBe('categories');
      // Joinable to the mailbox without naming it (telemetry reference).
      expect(failure?.mailboxRef).toMatch(/^ref_/);
    });
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
        onSendersRecategorized: NO_RESCORE,
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
    // Same trap for every counter this PR added: each must reach the line.
    for (const key of [
      'categoriesCorrected',
      'primaryKeepsExpired',
      'protectionsReleased',
      'rescoresRequested',
      'rescoresNotRequested',
    ]) {
      expect(succeeded?.result).toHaveProperty(key);
    }
  });

  it('purges stored drafts before reconciling, and says so on the ops line', async () => {
    // A draft used to land as INBOUND mail From the owner, so the owner
    // became a sender built from nothing else. The purge runs first so
    // the reconcile after it never sees that row — the sender and its
    // months go, rather than surviving as a zeroed shell.
    await db.insert(senders).values({
      mailboxAccountId: mailboxId,
      senderKey: 'owner-self',
      email: 'owner@ex.com',
      domain: 'ex.com',
      gmailCategory: 'primary',
      firstSeenAt: RECENT,
      lastSeenAt: RECENT,
      totalReceived: 1,
    });
    await db.insert(mailMessages).values({
      mailboxAccountId: mailboxId,
      providerMessageId: 'draft-1',
      providerThreadId: 't-draft-1',
      senderKey: 'owner-self',
      internalDate: new Date('2026-08-05T00:00:00Z'),
      labelIds: ['DRAFT'],
      isUnread: false,
      isOutbound: false,
    });
    await db.insert(senderTimeseries).values({
      mailboxAccountId: mailboxId,
      senderKey: 'owner-self',
      yearMonth: MONTH,
      volume: 1,
      readCount: 1,
    });

    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    try {
      await new SenderIndexSweepWorker({
        db: db as never,
        lock: PASSTHROUGH_MAILBOX_LOCK,
        outbox: new OutboxPublisher(),
        onSendersRecategorized: NO_RESCORE,
      }).run({
        id: 'sweep-1',
        data: { scheduledAtMinute: '2026-08-24T03:00' },
        attemptsMade: 0,
      } as never);
    } finally {
      spy.mockRestore();
    }

    expect(await db.select().from(mailMessages)).toEqual([]);
    expect(await db.select().from(senders)).toEqual([]);
    expect(await db.select().from(senderTimeseries)).toEqual([]);
    const succeeded = lines
      .map((l) => {
        try {
          return JSON.parse(l) as { kind?: string; result?: Record<string, unknown> };
        } catch {
          return null;
        }
      })
      .find((l) => l?.kind === 'worker.succeeded');
    expect(succeeded?.result).toMatchObject({
      nonMailMessagesDeleted: 1,
      nonMailSendersDeleted: 1,
      nonMailPurgeFailed: 0,
      timeseriesZeroed: 0,
    });
  });

  it('still retires protections when the purge throws — D245 never waits on the cleanup', async () => {
    await db.insert(senders).values({
      mailboxAccountId: mailboxId,
      senderKey: 'stale-star',
      email: 'stale@ex.com',
      domain: 'ex.com',
      gmailCategory: 'promotions',
      firstSeenAt: LONG_AGO,
      lastSeenAt: LONG_AGO,
    });
    await db.insert(mailMessages).values([
      {
        mailboxAccountId: mailboxId,
        providerMessageId: 'old-star',
        providerThreadId: 't-old-star',
        senderKey: 'stale-star',
        internalDate: LONG_AGO,
        labelIds: ['INBOX', 'STARRED'],
        isUnread: false,
        isOutbound: false,
      },
      {
        mailboxAccountId: mailboxId,
        providerMessageId: 'draft-1',
        providerThreadId: 't-draft-1',
        senderKey: 'owner-self',
        internalDate: RECENT,
        labelIds: ['DRAFT'],
        isUnread: false,
        isOutbound: false,
      },
    ]);
    await seedProtection('stale-star', 'starred');
    // The purge's batch is the first thing to take the lock; fail it.
    let calls = 0;
    const worker = new SenderIndexSweepWorker({
      db: db as never,
      lock: {
        run: async (_id, fn) => {
          calls += 1;
          if (calls === 1) throw new Error('purge boom');
          return fn();
        },
      },
      outbox: new OutboxPublisher(),
      onSendersRecategorized: NO_RESCORE,
    });
    const captureBackgroundFailure = vi.fn();
    worker.setObserver({
      captureFailure: vi.fn(),
      captureBackgroundFailure,
      recordBackgroundNotice: vi.fn(),
    });
    const result = await worker.processJob({ scheduledAtMinute: '2026-08-24T03:00' }, CTX);

    expect(result).toMatchObject({
      nonMailPurgeFailed: 1,
      nonMailMessagesDeleted: 0,
      mailboxesProcessed: 1,
      mailboxesFailed: 0,
    });
    // Reported, not just counted: the job itself still succeeds.
    expect(captureBackgroundFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'purge boom' }),
      expect.objectContaining({ kind: 'sender_index_sweep.non_mail_purge_failed' }),
    );
    expect((await policyFor('stale-star'))?.isProtected).toBe(false);
    // Not purged this pass; the next one will.
    const drafts = await db
      .select({ id: mailMessages.providerMessageId })
      .from(mailMessages)
      .where(eq(mailMessages.providerMessageId, 'draft-1'));
    expect(drafts).toHaveLength(1);
  });

  it('leaves a deadline abort during the purge to the base worker — never reported twice (D203)', async () => {
    await db.insert(mailMessages).values({
      mailboxAccountId: mailboxId,
      providerMessageId: 'draft-1',
      providerThreadId: 't-draft-1',
      senderKey: 'owner-self',
      internalDate: RECENT,
      labelIds: ['DRAFT'],
      isUnread: false,
      isOutbound: false,
    });
    // The job's deadline fires while a purge batch waits for the lock.
    const controller = new AbortController();
    const worker = new SenderIndexSweepWorker({
      db: db as never,
      lock: {
        run: async () => {
          controller.abort(new Error('fixture deadline'));
          throw new Error('fixture deadline');
        },
      },
      outbox: new OutboxPublisher(),
      onSendersRecategorized: NO_RESCORE,
    });
    const captureBackgroundFailure = vi.fn();
    worker.setObserver({
      captureFailure: vi.fn(),
      captureBackgroundFailure,
      recordBackgroundNotice: vi.fn(),
    });

    await expect(
      worker.processJob(
        { scheduledAtMinute: '2026-08-24T03:00' },
        { ...CTX, signal: controller.signal },
      ),
    ).rejects.toThrow('fixture deadline');
    expect(captureBackgroundFailure).not.toHaveBeenCalled();
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
      onSendersRecategorized: NO_RESCORE,
    });
    while (pending.length) await worker.processJob(pending.shift()!, CTX);
    // One short lock hold per step, so each mailbox appears once per step,
    // back to back; a mailbox swept twice would show twice that.
    const distinct = [...new Set(visited)];
    expect(distinct).toHaveLength(MAILBOX_BATCH_SIZE + 3);
    expect(distinct).toEqual([...distinct].sort());
    for (const id of distinct) {
      expect(visited.filter((v) => v === id)).toHaveLength(HOLDS_PER_MAILBOX);
    }
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
        onSendersRecategorized: NO_RESCORE,
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
      onSendersRecategorized: NO_RESCORE,
    });
    await expect(worker.processJob({ scheduledAtMinute: '2026-09-22T03:00' }, CTX)).rejects.toThrow(
      /all 1 eligible/,
    );
    expect(continuations).toHaveLength(1);
    await worker.processJob(continuations[0]!, CTX);
    expect([...new Set(visited)]).toEqual([mailboxId, second].sort());
    // The failed mailbox never got past the lock; the next one ran every step.
    expect(visited.filter((v) => v === firstId)).toHaveLength(1);
    expect(visited.filter((v) => v !== firstId)).toHaveLength(HOLDS_PER_MAILBOX);
  });
});
