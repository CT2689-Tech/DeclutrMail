import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  accountDeletionRequests,
  actionJobs,
  actionRecoveryPreviews,
  activityLog,
  automationRules,
  briefRuns,
  cronRuns,
  deadLetterJobs,
  followupTracker,
  mailboxAccounts,
  mailboxDataDeletionRequests,
  mailMessages,
  outboxEvents,
  providerSyncState,
  productFeedback,
  ruleMatchLog,
  schema,
  screenerQuarantine,
  securityEvents,
  senderPolicies,
  senderTimeseries,
  senders,
  triageDecisions,
  undoJournal,
  users,
  webhookDedup,
  workspaces,
} from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import type { Queue } from 'bullmq';

import {
  AccountDeletionPurgeWorker,
  MAILBOX_PURGE_DIRECT_CHILD_TABLES,
} from './deletion.worker.js';
import { isSyncPausedForDeletion } from './deletion-pause.js';
import type { EmailSendJobData } from './email-send.worker.js';
import type { GmailWatchAccess, GmailWatchClient } from './ports.js';
import type { WorkerContext } from './worker-context.js';

/**
 * AccountDeletionPurgeWorker integration tests (D205, D216, D232).
 *
 * Real worker against PGlite with every migration applied. Asserts the
 * cron_runs idempotency claim, the due-scan (pending past effective_at
 * + stranded executing takeover), the full FK-safe purge, the
 * receipt-before-drop email with recipientOverride, the surviving
 * security_events audit row, best-effort watch stops, and the D232
 * sync-pause predicate.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');
const TOPIC = 'projects/p/topics/gmail-push';

type Db = ReturnType<typeof drizzle<typeof schema>>;

async function freshHarness(): Promise<{ db: Db; pg: PGlite }> {
  const pg = new PGlite({ extensions: { citext } });
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sqlText = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sqlText.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await pg.query(trimmed);
      }
    }
  }
  return { db: drizzle(pg, { schema }), pg };
}

async function freshDb(): Promise<Db> {
  return (await freshHarness()).db;
}

const ctx = {} as WorkerContext;

function fakeWatch(opts?: { failFor?: string[] }): {
  access: GmailWatchAccess;
  stopped: string[];
} {
  const stopped: string[] = [];
  const access: GmailWatchAccess = {
    getClient: async (mailboxAccountId: string): Promise<GmailWatchClient> => ({
      watch: async () => {
        throw new Error('not under test');
      },
      stopWatch: async () => {
        if (opts?.failFor?.includes(mailboxAccountId)) {
          throw new Error('invalid_grant');
        }
        stopped.push(mailboxAccountId);
      },
    }),
  };
  return { access, stopped };
}

function fakeEmailQueue(): { queue: Queue<EmailSendJobData>; jobs: EmailSendJobData[] } {
  const jobs: EmailSendJobData[] = [];
  const queue = {
    getJob: async (jobId: string) => jobs.find((j) => j.idempotencyKey === jobId),
    add: async (_name: string, data: EmailSendJobData) => {
      jobs.push(data);
    },
  } as unknown as Queue<EmailSendJobData>;
  return { queue, jobs };
}

interface Seeded {
  userId: string;
  workspaceId: string;
  mailboxIds: string[];
  requestId: string;
}

let seedSeq = 0;

async function seedDueDeletion(
  db: Db,
  opts?: { effectiveAt?: Date; status?: 'pending' | 'executing'; executedAt?: Date },
): Promise<Seeded> {
  seedSeq += 1;
  const tag = `u${seedSeq}`;
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `Doomed ${tag}` })
    .returning({
      id: workspaces.id,
    });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: `doomed-${tag}@declutrmail.ai` })
    .returning({ id: users.id });
  const mailboxIds: string[] = [];
  for (const address of [`doomed-${tag}-a@x.com`, `doomed-${tag}-b@x.com`]) {
    const [mb] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: ws!.id,
        userId: user!.id,
        provider: 'gmail',
        providerAccountId: address,
      })
      .returning({ id: mailboxAccounts.id });
    mailboxIds.push(mb!.id);
    await db.insert(senders).values({
      mailboxAccountId: mb!.id,
      senderKey: `news@${address}`,
      email: `news@${address}`,
      domain: 'x.com',
      gmailCategory: 'updates',
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    });
    await db.insert(mailMessages).values(
      [1, 2, 3].map((n) => ({
        mailboxAccountId: mb!.id,
        providerMessageId: `${address}-${n}`,
        providerThreadId: `${address}-t${n}`,
        senderKey: `news@${address}`,
        internalDate: new Date(),
        isUnread: true,
      })),
    );
    await db.insert(undoJournal).values({
      mailboxAccountId: mb!.id,
      actionKind: 'archive',
      payload: {},
      expiresAt: new Date(Date.now() + 60_000),
    });
  }
  const [request] = await db
    .insert(accountDeletionRequests)
    .values({
      userId: user!.id,
      effectiveAt: opts?.effectiveAt ?? new Date(Date.now() - 60_000),
      basis: 'flat-grace',
      status: opts?.status ?? 'pending',
      ...(opts?.executedAt ? { executedAt: opts.executedAt } : {}),
    })
    .returning({ id: accountDeletionRequests.id });
  return { userId: user!.id, workspaceId: ws!.id, mailboxIds, requestId: request!.id };
}

function makeWorker(db: Db) {
  const watch = fakeWatch();
  const email = fakeEmailQueue();
  const worker = new AccountDeletionPurgeWorker({
    db: db as never,
    gmailWatch: watch.access,
    topicName: TOPIC,
    emailQueue: email.queue,
    renderReceiptEmail: ({ deletedAt }) => ({
      subject: 'Your DeclutrMail data has been deleted',
      text: `Deleted on ${deletedAt}.`,
    }),
  });
  return { worker, watch, email };
}

interface MailboxGraph {
  mailboxId: string;
  userId: string;
  workspaceId: string;
}

/** Seed one row in every direct mailbox child plus both non-FK stores. */
async function seedMailboxGraph(
  db: Db,
  tag: string,
  owner?: { userId: string; workspaceId: string },
): Promise<MailboxGraph> {
  let workspaceId = owner?.workspaceId;
  let userId = owner?.userId;
  if (!workspaceId || !userId) {
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: `Mailbox purge ${tag}` })
      .returning({ id: workspaces.id });
    workspaceId = workspace!.id;
    const [user] = await db
      .insert(users)
      .values({
        workspaceId,
        email: `${tag}@declutrmail.test`,
        preferences: {
          onboardingFirstTriageKeys: [`pinned-${tag}`],
        },
      })
      .returning({ id: users.id });
    userId = user!.id;
  }

  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId,
      userId,
      provider: 'gmail',
      providerAccountId: `${tag}@gmail.test`,
      status: 'active',
      quietState: { gmail_watch: { history_id: '9' }, quiet_hours: { enabled: true } },
      encryptedRefreshToken: Buffer.from(`token-${tag}`),
      dekEncrypted: Buffer.from(`dek-${tag}`),
      keyVersion: 1,
      connectedAt: new Date(),
    })
    .returning({ id: mailboxAccounts.id });
  const mailboxId = mailbox!.id;
  const senderKey = tag.padEnd(64, '0').slice(0, 64);
  const now = new Date();

  await db.insert(mailMessages).values({
    mailboxAccountId: mailboxId,
    providerMessageId: `message-${tag}`,
    providerThreadId: `thread-${tag}`,
    senderKey,
    subject: `Subject ${tag}`,
    snippet: `Snippet ${tag}`,
    internalDate: now,
    isUnread: true,
  });
  await db.insert(senders).values({
    mailboxAccountId: mailboxId,
    senderKey,
    displayName: `Sender ${tag}`,
    email: `sender-${tag}@example.test`,
    domain: 'example.test',
    gmailCategory: 'updates',
    firstSeenAt: now,
    lastSeenAt: now,
  });
  await db.insert(senderTimeseries).values({
    mailboxAccountId: mailboxId,
    senderKey,
    yearMonth: '2026-07-01',
    volume: 1,
  });
  await db.insert(senderPolicies).values({ mailboxAccountId: mailboxId, senderKey });
  await db.insert(triageDecisions).values({
    mailboxAccountId: mailboxId,
    senderKey,
    verdict: 'archive',
    confidence: '0.90',
    reasoning: 'Fixture',
    generatedBy: 'template',
    expiresAt: new Date(Date.now() + 60_000),
  });
  const [rule] = await db
    .insert(automationRules)
    .values({
      mailboxAccountId: mailboxId,
      presetKey: 'auto_archive_low_engagement',
      name: 'Fixture',
      actionKind: 'archive',
    })
    .returning({ id: automationRules.id });
  const [journal] = await db
    .insert(undoJournal)
    .values({
      mailboxAccountId: mailboxId,
      actionKind: 'archive',
      payload: { message_ids: [`message-${tag}`] },
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning({ token: undoJournal.token });
  await db.insert(ruleMatchLog).values({
    ruleId: rule!.id,
    mailboxAccountId: mailboxId,
    senderKey,
    modeAtMatch: 'observe',
    confidence: '0.90',
    reason: 'Fixture match',
    intentToken: journal!.token,
  });
  const [activity] = await db
    .insert(activityLog)
    .values({
      mailboxAccountId: mailboxId,
      senderKey,
      source: 'manual',
      action: 'archive',
      affectedCount: 1,
      undoToken: journal!.token,
      ruleId: rule!.id,
    })
    .returning({ id: activityLog.id });
  await db.insert(productFeedback).values({
    workspaceId,
    userId,
    mailboxAccountId: mailboxId,
    surface: 'activity',
    rating: 'expected',
    activityLogId: activity!.id,
  });
  const [action] = await db
    .insert(actionJobs)
    .values({
      mailboxAccountId: mailboxId,
      verb: 'archive',
      selector: { type: 'messages' },
      resolvedMessageIds: [`message-${tag}`],
      idempotencyKey: `fixture-${tag}`,
      undoToken: journal!.token,
    })
    .returning({ id: actionJobs.id });
  await db.insert(actionRecoveryPreviews).values({
    mailboxAccountId: mailboxId,
    rootActionId: action!.id,
    currentActionId: action!.id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  await db.insert(briefRuns).values({
    workspaceId,
    mailboxAccountId: mailboxId,
    runDateLocal: '2026-07-14',
    generatedBy: 'template',
  });
  await db.insert(followupTracker).values({
    workspaceId,
    mailboxAccountId: mailboxId,
    providerThreadId: `thread-${tag}`,
    recipientEmail: `recipient-${tag}@example.test`,
    subject: `Followup ${tag}`,
    sentAt: now,
  });
  await db.insert(screenerQuarantine).values({ mailboxAccountId: mailboxId, senderKey });
  await db.insert(providerSyncState).values({
    mailboxAccountId: mailboxId,
    readinessStatus: 'ready',
    currentStage: 'ready',
    progressPct: 100,
    lastHistoryId: 9n,
  });
  await db.insert(webhookDedup).values({
    messageId: `pubsub-${tag}`,
    mailboxAccountId: mailboxId,
    expiresAt: new Date(Date.now() + 60_000),
  });
  await db.insert(outboxEvents).values({
    topic: 'fixture.mailbox_indexed',
    aggregateId: mailboxId,
    payload: { mailboxAccountId: mailboxId, senderKey },
  });
  await db.insert(deadLetterJobs).values({
    queue: 'fixture',
    jobId: `job-${tag}`,
    payload: { mailboxAccountId: mailboxId, senderKey },
    error: 'fixture failure',
  });

  return { mailboxId, userId, workspaceId };
}

describe('AccountDeletionPurgeWorker', () => {
  it('purges a due request end-to-end (rows gone, audit survives, receipt enqueued, watches stopped)', async () => {
    const db = await freshDb();
    const seeded = await seedDueDeletion(db);
    const { worker, watch, email } = makeWorker(db);

    const result = await worker.processJob({ scheduledAtMinute: '2026-06-11T10:00' }, ctx);

    expect(result.outcome).toBe('swept');
    expect(result.due).toBe(1);
    expect(result.purged).toBe(1);
    expect(result.failed).toBe(0);

    // Data drop — every workspace-scoped row is gone.
    expect(await db.select().from(mailMessages)).toHaveLength(0);
    expect(await db.select().from(senders)).toHaveLength(0);
    expect(await db.select().from(undoJournal)).toHaveLength(0);
    expect(await db.select().from(mailboxAccounts)).toHaveLength(0);
    expect(await db.select().from(users)).toHaveLength(0);
    expect(await db.select().from(workspaces)).toHaveLength(0);
    // The request row cascades with the user — deliberate (schema doc).
    expect(await db.select().from(accountDeletionRequests)).toHaveLength(0);

    // Audit row SURVIVES the drop (FKs SET NULL; payload carries ids).
    const events = await db
      .select()
      .from(securityEvents)
      .where(eq(securityEvents.eventType, 'account.deletion_executed'));
    expect(events).toHaveLength(1);
    expect(events[0]!.userId).toBeNull(); // nulled by the drop
    const payload = events[0]!.payload as Record<string, unknown>;
    expect(payload.requestId).toBe(seeded.requestId);
    expect(payload.userId).toBe(seeded.userId);
    expect(payload.mailboxCount).toBe(2);

    // Receipt enqueued BEFORE the drop, addressed via recipientOverride.
    expect(email.jobs).toHaveLength(1);
    expect(email.jobs[0]!.kind).toBe('deletion-receipt');
    expect(email.jobs[0]!.recipientOverride).toMatch(/^doomed-u\d+@declutrmail\.ai$/);
    expect(email.jobs[0]!.idempotencyKey).toBe(`email__deletion-receipt__${seeded.requestId}`);

    // users.stop per mailbox.
    expect(watch.stopped.sort()).toEqual([...seeded.mailboxIds].sort());
  });

  it('leaves future-dated and cancelled requests untouched', async () => {
    const db = await freshDb();
    await seedDueDeletion(db, { effectiveAt: new Date(Date.now() + 60 * 60 * 1000) });
    const cancelled = await seedDueDeletion(db);
    await db
      .update(accountDeletionRequests)
      .set({ status: 'cancelled', cancelledAt: new Date() })
      .where(eq(accountDeletionRequests.id, cancelled.requestId));
    const { worker, email } = makeWorker(db);

    const result = await worker.processJob({ scheduledAtMinute: '2026-06-11T10:05' }, ctx);

    expect(result.due).toBe(0);
    expect(result.purged).toBe(0);
    expect(await db.select().from(users)).toHaveLength(2);
    expect(await db.select().from(mailMessages)).toHaveLength(12);
    expect(email.jobs).toHaveLength(0);
  });

  it('takes over a stranded executing request (crash resume) without double-auditing', async () => {
    const db = await freshDb();
    const seeded = await seedDueDeletion(db, {
      status: 'executing',
      executedAt: new Date(Date.now() - 30 * 60 * 1000), // stranded 30 min
    });
    // Simulate a crash AFTER the audit step: the audit row already exists.
    await db.insert(securityEvents).values({
      eventType: 'account.deletion_executed',
      severity: 'warning',
      userId: seeded.userId,
      workspaceId: seeded.workspaceId,
      payload: { requestId: seeded.requestId },
    });
    const { worker } = makeWorker(db);

    const result = await worker.processJob({ scheduledAtMinute: '2026-06-11T10:10' }, ctx);

    expect(result.due).toBe(1);
    expect(result.purged).toBe(1);
    expect(await db.select().from(users)).toHaveLength(0);
    // Still exactly ONE audit row — the resume did not duplicate it.
    const events = await db
      .select()
      .from(securityEvents)
      .where(eq(securityEvents.eventType, 'account.deletion_executed'));
    expect(events).toHaveLength(1);
  });

  it('does NOT take over a freshly-executing request (live run protection)', async () => {
    const db = await freshDb();
    await seedDueDeletion(db, { status: 'executing', executedAt: new Date() });
    const { worker } = makeWorker(db);

    const result = await worker.processJob({ scheduledAtMinute: '2026-06-11T10:15' }, ctx);

    expect(result.due).toBe(0);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it('a takeover claim that lost the replica race is skipped (no double purge)', async () => {
    const db = await freshDb();
    const seeded = await seedDueDeletion(db, {
      status: 'executing',
      executedAt: new Date(Date.now() - 30 * 60 * 1000), // stranded
    });
    const { worker, email } = makeWorker(db);
    const sweep = worker as unknown as {
      findDueRequests(): Promise<{ id: string }[]>;
      purgeOne(request: { id: string }): Promise<void>;
    };

    // Replica B's sweep reads the stranded row as due…
    const due = await sweep.findDueRequests();
    expect(due).toHaveLength(1);
    expect(due[0]!.id).toBe(seeded.requestId);

    // …but replica A's claim commits first (fresh executed_at).
    await db
      .update(accountDeletionRequests)
      .set({ status: 'executing', executedAt: new Date() })
      .where(eq(accountDeletionRequests.id, seeded.requestId));

    // Replica B's claim must lose: no purge, no receipt, no audit.
    await sweep.purgeOne(due[0]!);

    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(mailMessages)).toHaveLength(6);
    expect(email.jobs).toHaveLength(0);
    expect(
      await db
        .select()
        .from(securityEvents)
        .where(eq(securityEvents.eventType, 'account.deletion_executed')),
    ).toHaveLength(0);
  });

  it('the claim itself rejects a fresh executing row (takeover cutoff re-asserted)', async () => {
    const db = await freshDb();
    const freshExecutedAt = new Date(Date.now() - 2 * 60 * 1000); // 2 min < cutoff
    const seeded = await seedDueDeletion(db, { status: 'executing', executedAt: freshExecutedAt });
    const { worker, email } = makeWorker(db);

    // Force the claim directly (as if a sweep raced past the due-scan).
    await (
      worker as unknown as { purgeOne(request: { id: string; userId: string }): Promise<void> }
    ).purgeOne({ id: seeded.requestId, userId: seeded.userId });

    // Claim lost: row untouched (executed_at NOT refreshed), nothing purged.
    const [row] = await db
      .select()
      .from(accountDeletionRequests)
      .where(eq(accountDeletionRequests.id, seeded.requestId));
    expect(row!.status).toBe('executing');
    expect(row!.executedAt).toEqual(freshExecutedAt);
    expect(await db.select().from(users)).toHaveLength(1);
    expect(email.jobs).toHaveLength(0);
  });

  it('a failed watch stop never blocks the purge (best-effort)', async () => {
    const db = await freshDb();
    const seeded = await seedDueDeletion(db);
    const watch = fakeWatch({ failFor: [seeded.mailboxIds[0]!] });
    const email = fakeEmailQueue();
    const worker = new AccountDeletionPurgeWorker({
      db: db as never,
      gmailWatch: watch.access,
      topicName: TOPIC,
      emailQueue: email.queue,
      renderReceiptEmail: () => ({ subject: 's', text: 't' }),
    });

    const result = await worker.processJob({ scheduledAtMinute: '2026-06-11T10:20' }, ctx);

    expect(result.purged).toBe(1);
    expect(watch.stopped).toEqual([seeded.mailboxIds[1]]);
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it('only deletes the user (not the workspace) when another member exists', async () => {
    const db = await freshDb();
    const seeded = await seedDueDeletion(db);
    await db
      .insert(users)
      .values({ workspaceId: seeded.workspaceId, email: 'survivor@declutrmail.ai' });
    const { worker } = makeWorker(db);

    const result = await worker.processJob({ scheduledAtMinute: '2026-06-11T10:25' }, ctx);

    expect(result.purged).toBe(1);
    const remainingUsers = await db.select().from(users);
    expect(remainingUsers).toHaveLength(1);
    expect(remainingUsers[0]!.email).toBe('survivor@declutrmail.ai');
    expect(await db.select().from(workspaces)).toHaveLength(1);
  });

  it('duplicate run-key is a clean no-op (D225 cron idempotency)', async () => {
    const db = await freshDb();
    await seedDueDeletion(db, { effectiveAt: new Date(Date.now() + 60 * 60 * 1000) });
    const { worker } = makeWorker(db);

    const first = await worker.processJob({ scheduledAtMinute: '2026-06-11T10:30' }, ctx);
    expect(first.outcome).toBe('swept');
    const second = await worker.processJob({ scheduledAtMinute: '2026-06-11T10:30' }, ctx);
    expect(second.outcome).toBe('duplicate_run_key');

    const runs = await db.select().from(cronRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('succeeded');
  });
});

describe('mailbox indexed-data purge', () => {
  it('purges only the target index, preserves its stub, and completes the durable request', async () => {
    const { db, pg } = await freshHarness();
    const target = await seedMailboxGraph(db, 'target');
    const sibling = await seedMailboxGraph(db, 'sibling', {
      userId: target.userId,
      workspaceId: target.workspaceId,
    });
    const stranger = await seedMailboxGraph(db, 'stranger');
    await db
      .update(users)
      .set({
        preferences: {
          activeMailboxId: target.mailboxId,
          onboardingFirstTriageKeys: ['target-pin'],
          keepMe: true,
        },
      })
      .where(eq(users.id, target.userId));
    await db
      .update(users)
      .set({
        preferences: {
          activeMailboxId: stranger.mailboxId,
          onboardingFirstTriageKeys: ['stranger-pin'],
        },
      })
      .where(eq(users.id, stranger.userId));
    const [request] = await db
      .insert(mailboxDataDeletionRequests)
      .values({ mailboxAccountId: target.mailboxId })
      .returning({ id: mailboxDataDeletionRequests.id });

    const { worker, watch } = makeWorker(db);
    const result = await worker.processJob({ scheduledAtMinute: '2026-07-14T10:00' }, ctx);

    expect(result).toMatchObject({ outcome: 'swept', due: 1, purged: 1, failed: 0 });
    expect(watch.stopped).toEqual([target.mailboxId]);

    for (const table of MAILBOX_PURGE_DIRECT_CHILD_TABLES) {
      const targetCount = await pg.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "${table}" WHERE mailbox_account_id = $1`,
        [target.mailboxId],
      );
      const siblingCount = await pg.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "${table}" WHERE mailbox_account_id = $1`,
        [sibling.mailboxId],
      );
      expect(Number(targetCount.rows[0]!.count), `${table} target`).toBe(0);
      expect(Number(siblingCount.rows[0]!.count), `${table} sibling`).toBe(1);
    }

    for (const table of ['outbox_events', 'dead_letter_jobs']) {
      const targetCount = await pg.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "${table}" WHERE payload->>'mailboxAccountId' = $1`,
        [target.mailboxId],
      );
      const siblingCount = await pg.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "${table}" WHERE payload->>'mailboxAccountId' = $1`,
        [sibling.mailboxId],
      );
      expect(Number(targetCount.rows[0]!.count), `${table} target`).toBe(0);
      expect(Number(siblingCount.rows[0]!.count), `${table} sibling`).toBe(1);
    }

    const [stub] = await db
      .select()
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.id, target.mailboxId));
    expect(stub).toMatchObject({
      id: target.mailboxId,
      userId: target.userId,
      workspaceId: target.workspaceId,
      providerAccountId: 'target@gmail.test',
      status: 'disconnected',
      quietState: {},
      encryptedRefreshToken: null,
      dekEncrypted: null,
      keyVersion: null,
      connectedAt: null,
    });
    expect(
      await db.select().from(mailboxAccounts).where(eq(mailboxAccounts.id, sibling.mailboxId)),
    ).toHaveLength(1);
    expect(
      await db.select().from(mailboxAccounts).where(eq(mailboxAccounts.id, stranger.mailboxId)),
    ).toHaveLength(1);
    expect(await db.select().from(users)).toHaveLength(2);

    const [completed] = await db
      .select()
      .from(mailboxDataDeletionRequests)
      .where(eq(mailboxDataDeletionRequests.id, request!.id));
    expect(completed).toMatchObject({ status: 'completed', lastError: null });
    expect(completed!.completedAt).not.toBeNull();

    const [owner] = await db.select().from(users).where(eq(users.id, target.userId));
    expect(owner!.preferences).toEqual({ activeMailboxId: null, keepMe: true });
    const [otherUser] = await db.select().from(users).where(eq(users.id, stranger.userId));
    expect(otherUser!.preferences).toEqual({
      activeMailboxId: stranger.mailboxId,
      onboardingFirstTriageKeys: ['stranger-pin'],
    });

    const audit = await db
      .select()
      .from(securityEvents)
      .where(eq(securityEvents.eventType, 'mailbox.indexed_data_deleted'));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.payload).toEqual({
      requestId: request!.id,
      mailboxAccountId: target.mailboxId,
    });
  });

  it('registry covers every direct mailbox FK except the durable request table', async () => {
    const { pg } = await freshHarness();
    const result = await pg.query<{ table_name: string; delete_action: string }>(`
      SELECT child.relname AS table_name, constraint_row.confdeltype::text AS delete_action
      FROM pg_constraint constraint_row
      JOIN pg_class child ON child.oid = constraint_row.conrelid
      JOIN pg_class parent ON parent.oid = constraint_row.confrelid
      WHERE constraint_row.contype = 'f'
        AND parent.relname = 'mailbox_accounts'
      ORDER BY child.relname
    `);
    const requestFk = result.rows.find(
      (row) => row.table_name === 'mailbox_data_deletion_requests',
    );
    expect(requestFk?.delete_action).toBe('c');
    expect(
      result.rows
        .map((row) => row.table_name)
        .filter((table) => table !== 'mailbox_data_deletion_requests'),
    ).toEqual([...MAILBOX_PURGE_DIRECT_CHILD_TABLES]);
  });

  it('records a failed attempt and retries it on a later sweep', async () => {
    const db = await freshDb();
    const target = await seedMailboxGraph(db, 'retry');
    const [request] = await db
      .insert(mailboxDataDeletionRequests)
      .values({ mailboxAccountId: target.mailboxId })
      .returning({ id: mailboxDataDeletionRequests.id });
    let lockCalls = 0;
    const lock = {
      run: async <T>(_mailboxAccountId: string, fn: () => Promise<T>): Promise<T> => {
        lockCalls += 1;
        if (lockCalls === 1) throw new Error('injected lock failure');
        return fn();
      },
    };
    const watch = fakeWatch();
    const worker = new AccountDeletionPurgeWorker({
      db: db as never,
      gmailWatch: watch.access,
      topicName: null,
      emailQueue: null,
      mailboxLock: lock,
      renderReceiptEmail: () => ({ subject: 's', text: 't' }),
    });

    await expect(worker.processJob({ scheduledAtMinute: '2026-07-14T10:05' }, ctx)).rejects.toThrow(
      'all 1 due deletion requests failed',
    );
    const [failed] = await db
      .select()
      .from(mailboxDataDeletionRequests)
      .where(eq(mailboxDataDeletionRequests.id, request!.id));
    expect(failed).toMatchObject({ status: 'failed', lastError: 'Error' });
    expect(failed!.failedAt).not.toBeNull();

    const retry = await worker.processJob({ scheduledAtMinute: '2026-07-14T10:10' }, ctx);
    expect(retry).toMatchObject({ due: 1, purged: 1, failed: 0 });
    const [completed] = await db
      .select()
      .from(mailboxDataDeletionRequests)
      .where(eq(mailboxDataDeletionRequests.id, request!.id));
    expect(completed).toMatchObject({ status: 'completed', lastError: null, failedAt: null });
  });

  it('takes over a stranded executing mailbox request', async () => {
    const db = await freshDb();
    const target = await seedMailboxGraph(db, 'resume');
    const [request] = await db
      .insert(mailboxDataDeletionRequests)
      .values({
        mailboxAccountId: target.mailboxId,
        status: 'executing',
        executedAt: new Date(Date.now() - 30 * 60 * 1_000),
        updatedAt: new Date(Date.now() - 30 * 60 * 1_000),
      })
      .returning({ id: mailboxDataDeletionRequests.id });
    const { worker } = makeWorker(db);

    const result = await worker.processJob({ scheduledAtMinute: '2026-07-14T10:15' }, ctx);

    expect(result).toMatchObject({ due: 1, purged: 1, failed: 0 });
    const [completed] = await db
      .select()
      .from(mailboxDataDeletionRequests)
      .where(eq(mailboxDataDeletionRequests.id, request!.id));
    expect(completed!.status).toBe('completed');
  });
});

describe('isSyncPausedForDeletion (D232 sync pause predicate)', () => {
  it('true while pending/executing; false after cancel and for strangers', async () => {
    const db = await freshDb();
    const seeded = await seedDueDeletion(db);
    const stranger = await seedDueDeletion(db);
    await db
      .update(accountDeletionRequests)
      .set({ status: 'cancelled', cancelledAt: new Date() })
      .where(eq(accountDeletionRequests.userId, stranger.userId));

    // Pending → paused (every mailbox of the user).
    expect(await isSyncPausedForDeletion(db as never, seeded.mailboxIds[0]!)).toBe(true);
    expect(await isSyncPausedForDeletion(db as never, seeded.mailboxIds[1]!)).toBe(true);

    // Executing → still paused.
    await db
      .update(accountDeletionRequests)
      .set({ status: 'executing', executedAt: new Date() })
      .where(eq(accountDeletionRequests.userId, seeded.userId));
    expect(await isSyncPausedForDeletion(db as never, seeded.mailboxIds[0]!)).toBe(true);

    // Cancelled → resumed.
    expect(await isSyncPausedForDeletion(db as never, stranger.mailboxIds[0]!)).toBe(false);

    // Unknown mailbox → not paused.
    expect(await isSyncPausedForDeletion(db as never, '00000000-0000-0000-0000-000000000000')).toBe(
      false,
    );
  });

  it('also pauses a mailbox with a retryable indexed-data deletion request', async () => {
    const db = await freshDb();
    const mailbox = await seedMailboxGraph(db, 'pause-index');
    const [request] = await db
      .insert(mailboxDataDeletionRequests)
      .values({ mailboxAccountId: mailbox.mailboxId })
      .returning({ id: mailboxDataDeletionRequests.id });

    expect(await isSyncPausedForDeletion(db as never, mailbox.mailboxId)).toBe(true);

    await db
      .update(mailboxDataDeletionRequests)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(mailboxDataDeletionRequests.id, request!.id));
    expect(await isSyncPausedForDeletion(db as never, mailbox.mailboxId)).toBe(false);
  });
});
