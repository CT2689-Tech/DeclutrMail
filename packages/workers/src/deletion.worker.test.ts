import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  accountDeletionRequests,
  cronRuns,
  mailboxAccounts,
  mailMessages,
  schema,
  securityEvents,
  senders,
  undoJournal,
  users,
  workspaces,
} from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import type { Queue } from 'bullmq';

import { AccountDeletionPurgeWorker } from './deletion.worker.js';
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

async function freshDb(): Promise<Db> {
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
  return drizzle(pg, { schema });
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
});
