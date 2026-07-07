import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import {
  automationRules,
  mailboxAccounts,
  mailMessages,
  providerSyncState,
  ruleMatchLog,
  schema,
  senderPolicies,
  senders,
  triageDecisions,
  users,
  workspaces,
} from '@declutrmail/db';
import { describe, expect, it, vi } from 'vitest';

import { AUTOPILOT_APPLY_JOB } from './autopilot-apply.worker.js';
import {
  AUTOPILOT_APPLY_DELTA_WINDOW_MS,
  buildAutopilotApplyDeltaTrigger,
} from './autopilot-delta-trigger.js';
import { createAutopilotExecutionChain } from './autopilot-execution-chain.js';
import { seedAutopilotPresets } from './autopilot-preset-seeder.js';
import { IncrementalSyncWorker } from './incremental-sync.worker.js';
import { PASSTHROUGH_MAILBOX_LOCK } from './label-action.worker.js';
import { OutboxPublisher } from './outbox-publisher.js';
import { deriveSenderKey } from './sender-key.js';
import type { GmailMutationAccess } from './gmail-mutation-client.js';
import type {
  GmailAccess,
  GmailHistoryPage,
  GmailHistoryRecord,
  GmailMessageListPage,
  GmailMessageMetadata,
  GmailMetadataClient,
} from './ports.js';
import type { WorkerContext } from './worker-context.js';

/**
 * Incremental-sync delta → Autopilot apply trigger (D100 "on new
 * message arrival"; 2026-07-07 P0 audit). Mirrors the
 * `autopilot-execution-chain.test.ts` harness — PGlite + real
 * migrations — and proves the gap is closed end-to-end:
 *
 *   - new mail from an already-KNOWN sender (a `senders` conflict-
 *     update, so `onNewSender` — the only pre-existing incremental
 *     score trigger — never fires) still produces a debounced apply
 *     sweep, and that sweep executes an enabled Active rule;
 *   - the same sweep under an Observe rule collects a pending
 *     suggestion and enqueues NO action;
 *   - a no-op sync run (0 history records) enqueues nothing;
 *   - deltas inside one debounce window collapse to a single jobId.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');
const NOW = new Date('2026-06-10T08:00:00Z');
const KNOWN_SENDER_EMAIL = 'deals@shop.test';

async function freshDb() {
  const pg = new PGlite({ extensions: { citext } });
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await pg.query(trimmed);
      }
    }
  }
  return drizzle(pg, { schema });
}

const FAKE_CTX: WorkerContext = {
  jobId: 'test',
  workerName: 'IncrementalSyncWorker',
  attempt: 1,
  maxAttempts: 5,
  startedAt: new Date(),
  policy: 'perMailboxPolicy',
};

const UNUSED_GMAIL_MUTATION: GmailMutationAccess = {
  getClient: () => {
    throw new Error('apply pass must not touch Gmail');
  },
};

/**
 * Fake metadata client for the incremental worker — one scripted
 * history page + a metadata table (same shape as the
 * `incremental-sync.worker.test.ts` fake, single-page only).
 */
class FakeGmailClient implements GmailMetadataClient {
  constructor(
    private readonly records: GmailHistoryRecord[],
    private readonly metadata: Map<string, GmailMessageMetadata>,
  ) {}

  async listMessageIds(): Promise<GmailMessageListPage> {
    return { ids: [] };
  }

  async getMessageMetadata(messageId: string): Promise<GmailMessageMetadata | null> {
    return this.metadata.get(messageId) ?? null;
  }

  async getProfile(): Promise<{ historyId: string }> {
    return { historyId: '9999' };
  }

  async listHistory(startHistoryId: string): Promise<GmailHistoryPage | null> {
    return { records: this.records, historyId: startHistoryId === '1000' ? '2000' : '9999' };
  }
}

function accessFor(client: GmailMetadataClient): GmailAccess {
  return { getClient: async () => client };
}

/**
 * A mailbox whose sender index ALREADY KNOWS the newsletter sender —
 * `senders` row + fresh archive-verdict decision + the
 * `auto_archive_low_engagement` preset enabled in the given mode. Same
 * seed as the chain test, plus the `provider_sync_state` row the
 * incremental worker's cursor advance updates.
 */
async function seedKnownSenderMailbox(
  db: Awaited<ReturnType<typeof freshDb>>,
  mode: 'observe' | 'active',
): Promise<{ mailboxId: string; senderKey: string }> {
  const [ws] = await db.insert(workspaces).values({ name: 'WS' }).returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'a@b.com' })
    .returning({ id: users.id });
  const [mb] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: 'a@b.com',
    })
    .returning({ id: mailboxAccounts.id });
  const mailboxId = mb!.id;
  await db.insert(providerSyncState).values({
    mailboxAccountId: mailboxId,
    readinessStatus: 'ready',
    lastHistoryId: 1000n,
  });
  await seedAutopilotPresets(db as never, mailboxId);
  await db
    .update(automationRules)
    .set({ enabled: true, mode })
    .where(
      and(
        eq(automationRules.mailboxAccountId, mailboxId),
        eq(automationRules.presetKey, 'auto_archive_low_engagement'),
      ),
    );

  const senderKey = await deriveSenderKey(KNOWN_SENDER_EMAIL);
  await db.insert(senders).values({
    mailboxAccountId: mailboxId,
    senderKey,
    displayName: 'Shop',
    email: KNOWN_SENDER_EMAIL,
    domain: 'shop.test',
    gmailCategory: 'promotions',
    firstSeenAt: new Date('2024-01-01T00:00:00Z'),
    lastSeenAt: new Date('2026-06-01T00:00:00Z'),
  });
  await db.insert(triageDecisions).values({
    mailboxAccountId: mailboxId,
    senderKey,
    verdict: 'archive',
    confidence: '0.92',
    reasoning: 'test',
    generatedBy: 'template',
    producedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
  });
  return { mailboxId, senderKey };
}

/** One `messagesAdded` history record for a NEW message from the known sender. */
function knownSenderDelta(): {
  records: GmailHistoryRecord[];
  metadata: Map<string, GmailMessageMetadata>;
} {
  const meta: GmailMessageMetadata = {
    id: 'm-new',
    threadId: 'thread-new',
    labelIds: ['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS'],
    snippet: 'weekly deals',
    internalDate: String(NOW.getTime()),
    from: `Shop <${KNOWN_SENDER_EMAIL}>`,
    subject: 'Deals',
    to: null,
    cc: null,
    listUnsubscribe: null,
    listUnsubscribePost: null,
  };
  return {
    records: [
      { kind: 'added', messageId: 'm-new', threadId: 'thread-new', labelIds: meta.labelIds },
    ],
    metadata: new Map([['m-new', meta]]),
  };
}

function buildChain(db: Awaited<ReturnType<typeof freshDb>>) {
  const add = vi.fn().mockResolvedValue(undefined);
  const chain = createAutopilotExecutionChain({
    db: db as never,
    gmailMutation: UNUSED_GMAIL_MUTATION,
    outbox: new OutboxPublisher(),
    lock: PASSTHROUGH_MAILBOX_LOCK,
    actionQueue: { add } as never,
    enqueueUnsubExecution: () => Promise.resolve(),
    now: () => NOW,
  });
  return { chain, actionAdd: add };
}

/**
 * Run one incremental-sync delta with the production glue: the worker's
 * `onDeltaProcessed` wired to `buildAutopilotApplyDeltaTrigger` over a
 * fake apply queue, plus an `onNewSender` spy proving the known-sender
 * premise (the pre-existing score trigger stays silent).
 */
async function runSyncDelta(
  db: Awaited<ReturnType<typeof freshDb>>,
  mailboxId: string,
  delta: { records: GmailHistoryRecord[]; metadata: Map<string, GmailMessageMetadata> },
) {
  const applyAdd = vi.fn().mockResolvedValue(undefined);
  const onNewSender = vi.fn().mockResolvedValue(undefined);
  const worker = new IncrementalSyncWorker({
    db: db as never,
    gmailAccess: accessFor(new FakeGmailClient(delta.records, delta.metadata)),
    onNewSender,
    onDeltaProcessed: buildAutopilotApplyDeltaTrigger({ add: applyAdd } as never, {
      now: () => NOW,
    }),
  });
  const result = await worker.processJob(
    { mailboxAccountId: mailboxId, startHistoryId: '1000', endHistoryId: '2000' },
    FAKE_CTX,
  );
  return { result, applyAdd, onNewSender };
}

describe('incremental-sync delta → autopilot apply trigger', () => {
  it('known-sender new mail enqueues a debounced apply sweep and the Active rule fires', async () => {
    const db = await freshDb();
    const { mailboxId, senderKey } = await seedKnownSenderMailbox(db, 'active');

    const { result, applyAdd, onNewSender } = await runSyncDelta(db, mailboxId, knownSenderDelta());
    expect(result.recordsProcessed).toBe(1);
    expect(result.added).toBe(1);
    // KNOWN sender — the upsert is a conflict-update, so the score
    // trigger (the only pre-P0-fix incremental trigger) never fires.
    expect(onNewSender).not.toHaveBeenCalled();

    // The delta trigger enqueued ONE window-end apply sweep.
    expect(applyAdd).toHaveBeenCalledTimes(1);
    const [jobName, jobData, opts] = applyAdd.mock.calls[0] as [
      string,
      { mailboxAccountId: string; triggeredAtMs: number },
      { jobId: string; delay: number },
    ];
    const windowEndMs =
      (Math.floor(NOW.getTime() / AUTOPILOT_APPLY_DELTA_WINDOW_MS) + 1) *
      AUTOPILOT_APPLY_DELTA_WINDOW_MS;
    expect(jobName).toBe(AUTOPILOT_APPLY_JOB);
    expect(jobData).toEqual({ mailboxAccountId: mailboxId, triggeredAtMs: windowEndMs });
    expect(opts.jobId).toBe(`${mailboxId}-delta-${windowEndMs}`);
    expect(opts.jobId).not.toContain(':');
    expect(opts.delay).toBe(windowEndMs - NOW.getTime());

    // Deliver the delayed job (as BullMQ would at window end): the
    // Active-mode rule matches the known sender and chains one action
    // sweep — the rule is no longer dormant after sync_ready.
    const { chain, actionAdd } = buildChain(db);
    const applyResult = await chain.applyWorker.processJob(jobData, FAKE_CTX);
    expect(applyResult.activeMatches).toBeGreaterThan(0);
    expect(actionAdd).toHaveBeenCalledTimes(1);

    const matches = await db
      .select()
      .from(ruleMatchLog)
      .where(
        and(eq(ruleMatchLog.mailboxAccountId, mailboxId), eq(ruleMatchLog.senderKey, senderKey)),
      );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.modeAtMatch).toBe('active');
    expect(matches[0]!.resolution).toBe('approved');
    expect(matches[0]!.intentApplied).toBe(false);
  });

  it('an Observe rule collects a pending suggestion only — no action sweep', async () => {
    const db = await freshDb();
    const { mailboxId, senderKey } = await seedKnownSenderMailbox(db, 'observe');

    const { applyAdd, onNewSender } = await runSyncDelta(db, mailboxId, knownSenderDelta());
    expect(onNewSender).not.toHaveBeenCalled();
    expect(applyAdd).toHaveBeenCalledTimes(1);
    const [, jobData] = applyAdd.mock.calls[0] as [
      string,
      { mailboxAccountId: string; triggeredAtMs: number },
    ];

    const { chain, actionAdd } = buildChain(db);
    const applyResult = await chain.applyWorker.processJob(jobData, FAKE_CTX);
    expect(applyResult.observeMatches).toBeGreaterThan(0);
    expect(applyResult.activeMatches).toBe(0);
    expect(actionAdd).not.toHaveBeenCalled();

    const matches = await db
      .select()
      .from(ruleMatchLog)
      .where(
        and(eq(ruleMatchLog.mailboxAccountId, mailboxId), eq(ruleMatchLog.senderKey, senderKey)),
      );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.modeAtMatch).toBe('observe');
    expect(matches[0]!.resolution).toBe('pending');
  });

  it('a no-op sync run (0 history records) enqueues nothing', async () => {
    const db = await freshDb();
    const { mailboxId } = await seedKnownSenderMailbox(db, 'active');

    const { result, applyAdd } = await runSyncDelta(db, mailboxId, {
      records: [],
      metadata: new Map(),
    });
    expect(result.recordsProcessed).toBe(0);
    expect(applyAdd).not.toHaveBeenCalled();
  });

  it('deltas inside one debounce window collapse to a single jobId; the next window rolls it', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    let nowMs = NOW.getTime();
    const trigger = buildAutopilotApplyDeltaTrigger({ add } as never, {
      now: () => new Date(nowMs),
    });

    await trigger('mbx-1');
    nowMs += 30_000; // same window, 30s later
    await trigger('mbx-1');
    nowMs = NOW.getTime() + AUTOPILOT_APPLY_DELTA_WINDOW_MS; // next window
    await trigger('mbx-1');

    const jobIds = add.mock.calls.map((c) => (c[2] as { jobId: string }).jobId);
    expect(jobIds[0]).toBe(jobIds[1]); // BullMQ dedups the burst on jobId
    expect(jobIds[2]).not.toBe(jobIds[0]);
  });

  it('steady state — a swept-clean sender is NOT re-matched every window; new mail re-arms it', async () => {
    const db = await freshDb();
    const { mailboxId, senderKey } = await seedKnownSenderMailbox(db, 'active');

    // Sweep 1 — the delta's message is in INBOX, so the Active rule
    // matches and writes one approved row (the D100 fix working).
    const { applyAdd } = await runSyncDelta(db, mailboxId, knownSenderDelta());
    const [, jobData] = applyAdd.mock.calls[0] as [
      string,
      { mailboxAccountId: string; triggeredAtMs: number },
    ];
    const { chain } = buildChain(db);
    const first = await chain.applyWorker.processJob(jobData, FAKE_CTX);
    expect(first.activeMatches).toBe(1);

    // Simulate the action worker having executed the archive: the
    // INBOX label leaves the local projection and the match resolves.
    await db
      .update(mailMessages)
      .set({ labelIds: ['CATEGORY_PROMOTIONS'] })
      .where(and(eq(mailMessages.mailboxAccountId, mailboxId)));
    await db
      .update(ruleMatchLog)
      .set({ intentApplied: true, resolvedAt: NOW })
      .where(eq(ruleMatchLog.mailboxAccountId, mailboxId));

    // Sweep 2 (next delta window, nothing new in INBOX) — the rule
    // still MATCHES the sender, but acting would be a 0-affected no-op,
    // so no new approved row is inserted. Without this gate every
    // 5-min window re-wrote rule_match_log + action_jobs +
    // "archived 0" activity rows forever.
    const second = await chain.applyWorker.processJob(jobData, FAKE_CTX);
    expect(second.activeMatches).toBe(0);
    expect(second.activeSkippedNotActionable).toBeGreaterThan(0);
    const afterSecond = await db
      .select()
      .from(ruleMatchLog)
      .where(
        and(eq(ruleMatchLog.mailboxAccountId, mailboxId), eq(ruleMatchLog.senderKey, senderKey)),
      );
    expect(afterSecond).toHaveLength(1); // still just sweep 1's row

    // New mail arrives → sender is actionable again → sweep 3 writes a
    // fresh approved row. The D100 re-trigger semantics survive the gate.
    await db.insert(mailMessages).values({
      mailboxAccountId: mailboxId,
      providerMessageId: 'm-new-2',
      providerThreadId: 'thread-new-2',
      senderKey,
      subject: 'Deals again',
      snippet: 'more deals',
      labelIds: ['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS'],
      isUnread: true,
      internalDate: NOW,
    });
    const third = await chain.applyWorker.processJob(jobData, FAKE_CTX);
    expect(third.activeMatches).toBe(1);
    const afterThird = await db
      .select()
      .from(ruleMatchLog)
      .where(
        and(eq(ruleMatchLog.mailboxAccountId, mailboxId), eq(ruleMatchLog.senderKey, senderKey)),
      );
    expect(afterThird).toHaveLength(2);
  });

  it('unsubscribe rules skip senders already carrying the one-way unsubscribe policy', async () => {
    const db = await freshDb();
    const { mailboxId, senderKey } = await seedKnownSenderMailbox(db, 'active');
    // Swap the enabled rule: archive preset off, noisy-unsub preset on.
    await db
      .update(automationRules)
      .set({ enabled: false })
      .where(eq(automationRules.mailboxAccountId, mailboxId));
    await db
      .update(automationRules)
      .set({ enabled: true, mode: 'active' })
      .where(
        and(
          eq(automationRules.mailboxAccountId, mailboxId),
          eq(automationRules.presetKey, 'auto_unsubscribe_noisy'),
        ),
      );
    await db
      .update(triageDecisions)
      .set({ verdict: 'unsubscribe', confidence: '0.95' })
      .where(eq(triageDecisions.mailboxAccountId, mailboxId));
    // The sender already unsubscribed (one-way projection, D58).
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey,
      policyType: 'unsubscribe',
    });

    const { applyAdd } = await runSyncDelta(db, mailboxId, knownSenderDelta());
    const [, jobData] = applyAdd.mock.calls[0] as [
      string,
      { mailboxAccountId: string; triggeredAtMs: number },
    ];
    const { chain, actionAdd } = buildChain(db);
    const result = await chain.applyWorker.processJob(jobData, FAKE_CTX);

    // Matcher fires, gate skips: no approved row, no action sweep —
    // previously this re-wrote a match row every sweep just for the
    // action worker's already-unsubscribed guard to no-op it.
    expect(result.activeMatches).toBe(0);
    expect(result.activeSkippedNotActionable).toBeGreaterThan(0);
    expect(actionAdd).not.toHaveBeenCalled();
    const matches = await db
      .select()
      .from(ruleMatchLog)
      .where(eq(ruleMatchLog.mailboxAccountId, mailboxId));
    expect(matches).toHaveLength(0);
  });

  it('a failing delta trigger is swallowed — the sync run still succeeds (best-effort)', async () => {
    const db = await freshDb();
    const { mailboxId } = await seedKnownSenderMailbox(db, 'active');
    const delta = knownSenderDelta();

    const worker = new IncrementalSyncWorker({
      db: db as never,
      gmailAccess: accessFor(new FakeGmailClient(delta.records, delta.metadata)),
      onDeltaProcessed: () => Promise.reject(new Error('redis down')),
    });
    const result = await worker.processJob(
      { mailboxAccountId: mailboxId, startHistoryId: '1000', endHistoryId: '2000' },
      FAKE_CTX,
    );
    expect(result.recordsProcessed).toBe(1);
    expect(result.added).toBe(1);
  });
});
