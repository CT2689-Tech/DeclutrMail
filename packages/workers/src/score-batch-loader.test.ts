import {
  mailboxAccounts,
  mailMessages,
  senders,
  triageDecisions,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SCORE_CHUNK_SIZE, ScoreWorker } from './score.worker.js';
import type { ScoreWorkerDeps } from './score.worker.js';
import type { WorkerContext } from './worker-context.js';

/**
 * The batched signal loader (item 15).
 *
 * `loadSignals` used to issue six round trips PER SENDER; it now reads
 * from six grouped queries per CHUNK. The 83 tests in
 * `score.worker.test.ts` all pass against both forms, because they
 * exercise one sender at a time — where a grouped query and a
 * per-sender query are indistinguishable by construction.
 *
 * Everything that can break in the rewrite needs TWO senders and TWO
 * rows on each side to show itself: a GROUP BY dropped, a join
 * degenerating to a cross product, `COUNT(DISTINCT)` collapsed to
 * `COUNT`, or one sender's aggregate served to another. That is what
 * this file seeds.
 */
const CTX: WorkerContext = { attempt: 1, jobId: 'score-1' } as WorkerContext;
const NOW = new Date('2026-08-24T00:00:00Z');
const IN_WINDOW = new Date('2026-08-01T00:00:00Z');

type Db = ScoreWorkerDeps['db'];

async function seedMailbox(db: Db): Promise<string> {
  const [ws] = await db.insert(workspaces).values({ name: 'W' }).returning({ id: workspaces.id });
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
  return mb!.id;
}

async function seedSender(db: Db, mailboxAccountId: string, key: string, email: string) {
  await db.insert(senders).values({
    mailboxAccountId,
    senderKey: key,
    email,
    displayName: key,
    domain: email.split('@')[1]!,
    // NOT 'primary'. Cascade Rule 3 returns `keep` for Gmail's Primary
    // category and short-circuits before every volume and read-rate rule
    // below it — a 'primary' fixture cannot observe the aggregates this
    // file exists to check, and reports a confident pass while doing so.
    gmailCategory: 'promotions',
    firstSeenAt: new Date('2026-01-01T00:00:00Z'),
    lastSeenAt: IN_WINDOW,
  });
}

/** One INBOUND message from a sender. */
async function inbound(db: Db, mailboxAccountId: string, key: string, id: string) {
  await db.insert(mailMessages).values({
    mailboxAccountId,
    providerMessageId: id,
    providerThreadId: `t-${id}`,
    senderKey: key,
    subject: 's',
    snippet: '',
    internalDate: IN_WINDOW,
    labelIds: ['INBOX'],
    // Unread: a read rate at or above 50% is its own `keep` rule (Rule
    // 5), which would short-circuit past the volume comparison the same
    // way the Primary category did.
    isUnread: true,
    isOutbound: false,
  });
}

/** One OUTBOUND message addressed to `recipients`. */
async function outbound(db: Db, mailboxAccountId: string, id: string, recipients: string[]) {
  await db.insert(mailMessages).values({
    mailboxAccountId,
    providerMessageId: id,
    providerThreadId: `t-${id}`,
    senderKey: 'owner@example.com',
    subject: 's',
    snippet: '',
    internalDate: IN_WINDOW,
    labelIds: ['SENT'],
    isUnread: false,
    isOutbound: true,
    recipientEmails: recipients,
  });
}

function worker(db: Db, extra: Partial<ScoreWorkerDeps> = {}) {
  return new ScoreWorker({ db, now: () => NOW, ...extra } as ScoreWorkerDeps);
}

const sweep = (db: Db, mailboxAccountId: string, extra: Partial<ScoreWorkerDeps> = {}) =>
  worker(db, extra).processJob(
    { mailboxAccountId, trigger: 'cron_sweep', producedAtMs: NOW.getTime() },
    CTX,
  );

describe('batched signal loading', () => {
  let db: Db;
  let mailboxAccountId: string;

  beforeEach(async () => {
    db = (await freshTestDb()) as unknown as Db;
    mailboxAccountId = await seedMailbox(db);
  });

  it('attributes the wrote-to count to the RIGHT sender when several are scored', async () => {
    // The grouped rewrite joins `senders.email` back to the unnested
    // recipient address. Two senders and two outbound messages: if the
    // GROUP BY were dropped or the join degenerated, both senders would
    // read the same total and this fails.
    await seedSender(db, mailboxAccountId, 'alice', 'alice@ex.com');
    await seedSender(db, mailboxAccountId, 'bob', 'bob@ex.com');
    await inbound(db, mailboxAccountId, 'alice', 'a1');
    await inbound(db, mailboxAccountId, 'bob', 'b1');
    // The user wrote to alice twice, bob never.
    await outbound(db, mailboxAccountId, 'o1', ['alice@ex.com']);
    await outbound(db, mailboxAccountId, 'o2', ['alice@ex.com', 'someone@else.com']);

    await sweep(db, mailboxAccountId);

    const rows = await db
      .select({ k: triageDecisions.senderKey, v: triageDecisions.verdict })
      .from(triageDecisions)
      .where(eq(triageDecisions.mailboxAccountId, mailboxAccountId));
    expect(rows).toHaveLength(2);
    // `hasWrittenTo` is cascade Rule 2 — `keep`, and it exits. Bob has
    // one message and no outbound, so he falls to Rule 7 and gets
    // `later`. A join that degenerated to a cross product hands the
    // wrote-to fact to BOTH and they come back identical.
    expect(rows.find((r) => r.k === 'alice')?.v).toBe('keep');
    expect(rows.find((r) => r.k === 'bob')?.v).toBe('later');
  });

  it('counts a message addressed to the same sender twice as ONE message', async () => {
    // `COUNT(DISTINCT m.id)`. The LATERAL unnest emits a row per
    // recipient, so a message listing the same address in To and Cc
    // yields two rows and a plain COUNT would double it.
    //
    // Asserted against the LOADER, not the worker. `wroteTo` reaches the
    // cascade only as `hasWrittenTo: count > 0`, so 1 and 3 produce an
    // identical verdict — a worker-level test of this would pass whether
    // or not DISTINCT survived the rewrite, which is worse than no test.
    await seedSender(db, mailboxAccountId, 'alice', 'alice@ex.com');
    await inbound(db, mailboxAccountId, 'alice', 'a1');
    await outbound(db, mailboxAccountId, 'o1', ['alice@ex.com', 'ALICE@ex.com', 'alice@ex.com']);

    const w = worker(db);
    const batch = await (
      Reflect.get(w, 'loadSignalBatch') as (
        m: string,
        k: string[],
      ) => Promise<{
        wroteTo: Map<string, number>;
      }>
    ).call(w, mailboxAccountId, ['alice']);

    // One message, three recipient rows, one distinct id. Also proves
    // `dm_normalize_email` still folds the upper-case duplicate.
    expect(batch.wroteTo.get('alice')).toBe(1);
  });

  it('does not serve one sender the message aggregate of another', async () => {
    // Two senders with different volumes, asserted on the LOADER's own
    // output. Going through the cascade would work too, but only if the
    // fixture dodges every short-circuit rule above the volume check —
    // `primary` category and a ≥50% read rate both return `keep` and
    // exit, and both were silently doing so in an earlier draft of this
    // test. Reading the map directly checks the grouping itself.
    await seedSender(db, mailboxAccountId, 'loud', 'loud@ex.com');
    await seedSender(db, mailboxAccountId, 'quiet', 'quiet@ex.com');
    for (let i = 0; i < 8; i += 1) await inbound(db, mailboxAccountId, 'loud', `l${i}`);
    await inbound(db, mailboxAccountId, 'quiet', 'q1');

    const w = worker(db);
    const batch = await (
      Reflect.get(w, 'loadSignalBatch') as (
        m: string,
        k: string[],
      ) => Promise<{ messageAggregates: Map<string, { totalMessages: number; volume90: number }> }>
    ).call(w, mailboxAccountId, ['loud', 'quiet']);

    // A missing GROUP BY, or a grouping on the wrong column, gives both
    // senders the mailbox-wide total of 9.
    expect(batch.messageAggregates.get('loud')?.totalMessages).toBe(8);
    expect(batch.messageAggregates.get('quiet')?.totalMessages).toBe(1);
    expect(batch.messageAggregates.get('loud')?.volume90).toBe(8);
    expect(batch.messageAggregates.get('quiet')?.volume90).toBe(1);
  });

  it('scores both senders even when their aggregates differ', async () => {
    // The end-to-end companion to the assertion above: whatever verdicts
    // the cascade reaches, every seeded sender must come back with a row.
    await seedSender(db, mailboxAccountId, 'loud', 'loud@ex.com');
    await seedSender(db, mailboxAccountId, 'quiet', 'quiet@ex.com');
    for (let i = 0; i < 8; i += 1) await inbound(db, mailboxAccountId, 'loud', `l${i}`);
    await inbound(db, mailboxAccountId, 'quiet', 'q1');

    const result = await sweep(db, mailboxAccountId);

    expect(result.decisionsWritten).toBe(2);
    const rows = await db
      .select({ k: triageDecisions.senderKey })
      .from(triageDecisions)
      .where(eq(triageDecisions.mailboxAccountId, mailboxAccountId));
    expect(rows.map((r) => r.k).sort()).toEqual(['loud', 'quiet']);
  });

  it('reads a sender with no outbound mail as zero, not as missing', async () => {
    // Blind case for the wrote-to map. A sender absent from the grouped
    // result must read 0 — if the map lookup threw or defaulted wrong,
    // every sender the user never wrote to breaks the sweep.
    await seedSender(db, mailboxAccountId, 'alice', 'alice@ex.com');
    await inbound(db, mailboxAccountId, 'alice', 'a1');

    await expect(sweep(db, mailboxAccountId)).resolves.toBeDefined();
    const rows = await db.select().from(triageDecisions);
    expect(rows).toHaveLength(1);
  });

  it('scores senders beyond one chunk', async () => {
    // The loop boundary. With SCORE_CHUNK_SIZE senders + 1, an
    // off-by-one in the slice leaves the last sender unscored — and a
    // sweep that silently skips its tail reports success.
    const total = SCORE_CHUNK_SIZE + 1;
    for (let i = 0; i < total; i += 1) {
      await seedSender(db, mailboxAccountId, `s${i}`, `s${i}@ex.com`);
      await inbound(db, mailboxAccountId, `s${i}`, `m${i}`);
    }

    const result = await sweep(db, mailboxAccountId);

    expect(result.decisionsWritten).toBe(total);
    const rows = await db.select().from(triageDecisions);
    expect(rows).toHaveLength(total);
  });

  it('keeps completed chunks when a later chunk fails to prefetch', async () => {
    // THE FRAGILITY THIS ITEM EXISTS TO FIX. The sweep was one
    // `Promise.all` over every sender, which rejects on the first
    // rejection — so a single failure discarded ~8,000 senders of
    // completed work, and `perMailboxPolicy` has `timeoutMs: null` so
    // nothing bounded the retry.
    const total = SCORE_CHUNK_SIZE + 5;
    for (let i = 0; i < total; i += 1) {
      await seedSender(db, mailboxAccountId, `s${i}`, `s${i}@ex.com`);
      await inbound(db, mailboxAccountId, `s${i}`, `m${i}`);
    }

    const w = worker(db);
    const loadBatch = Reflect.get(w, 'loadSignalBatch') as (...a: unknown[]) => Promise<unknown>;
    let call = 0;
    const spy = vi
      .spyOn(
        w as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>,
        'loadSignalBatch',
      )
      .mockImplementation((...args: unknown[]) => {
        call += 1;
        if (call === 2) return Promise.reject(new Error('prefetch blew up'));
        return loadBatch.apply(w, args);
      });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await w.processJob(
      { mailboxAccountId, trigger: 'cron_sweep', producedAtMs: NOW.getTime() },
      CTX,
    );

    // The first chunk's work SURVIVED rather than being discarded.
    expect(result.decisionsWritten).toBe(SCORE_CHUNK_SIZE);
    const kinds = warn.mock.calls.map((c) => JSON.parse(String(c[0])).kind);
    expect(kinds).toContain('score.chunk_prefetch_failed');
    spy.mockRestore();
    warn.mockRestore();
  });

  it('fails loudly when EVERY sender fails, instead of reporting zero decisions', async () => {
    // A sweep where nothing succeeded looks identical on the ops line to
    // a mailbox with no senders. That is how a broken sweep stays broken.
    await seedSender(db, mailboxAccountId, 'alice', 'alice@ex.com');
    await inbound(db, mailboxAccountId, 'alice', 'a1');

    const w = worker(db);
    vi.spyOn(w as unknown as Record<string, () => Promise<unknown>>, 'scoreOne').mockImplementation(
      () => Promise.reject(new Error('boom')),
    );

    await expect(
      w.processJob({ mailboxAccountId, trigger: 'cron_sweep', producedAtMs: NOW.getTime() }, CTX),
    ).rejects.toThrow(/all 1 senders/);
  });
});
