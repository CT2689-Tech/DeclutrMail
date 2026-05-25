import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import {
  followupTracker,
  mailMessages,
  mailboxAccounts,
  schema,
  users,
  workspaces,
} from '@declutrmail/db';
import { describe, expect, it } from 'vitest';

import { FollowupCheckWorker } from './followup-check.worker.js';
import { scheduledAtMinute as followupCheckScheduledAtMinute } from './followup-check.queue.js';
import type { WorkerContext } from './worker-context.js';

/**
 * FollowupCheckWorker integration tests (D84, D85, D87, D88).
 *
 * Runs the real worker against an in-process PGlite database with every
 * migration applied. Covers the D86 exclusion rules, the
 * outbound-latest-in-thread rule, and the awaiting → replied flip.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');
const NOW = new Date('2026-05-25T08:00:00Z');

type Db = ReturnType<typeof drizzle<typeof schema>>;

async function freshDb(): Promise<Db> {
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

async function seedMailbox(
  db: Db,
  email = 'owner@example.com',
): Promise<{ workspaceId: string; mailboxAccountId: string }> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS-${email}` })
    .returning({
      id: workspaces.id,
    });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email })
    .returning({ id: users.id });
  const [mb] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: email,
    })
    .returning({ id: mailboxAccounts.id });
  return { workspaceId: ws!.id, mailboxAccountId: mb!.id };
}

interface SeedMessageInput {
  mailboxAccountId: string;
  threadId: string;
  internalDate: Date;
  isOutbound: boolean;
  recipients?: string[] | null;
  subject?: string;
  senderKey?: string;
  /** Stable suffix so multiple messages don't collide on the provider_message_id UNIQUE. */
  idSuffix?: string;
}

async function seedMessage(db: Db, input: SeedMessageInput): Promise<void> {
  const suffix = input.idSuffix ?? `${input.threadId}-${input.internalDate.getTime()}`;
  await db.insert(mailMessages).values({
    mailboxAccountId: input.mailboxAccountId,
    providerMessageId: `msg-${suffix}`,
    providerThreadId: input.threadId,
    senderKey: input.senderKey ?? 'a'.repeat(64),
    subject: input.subject ?? '',
    snippet: '',
    internalDate: input.internalDate,
    labelIds: input.isOutbound ? ['SENT'] : ['INBOX'],
    isUnread: !input.isOutbound,
    isOutbound: input.isOutbound,
    recipientEmails: input.recipients ?? null,
  });
}

const FAKE_CTX: WorkerContext = {
  jobId: 'test',
  workerName: 'FollowupCheckWorker',
  attempt: 1,
  maxAttempts: 3,
  startedAt: new Date(),
  policy: 'cronPolicy',
};

describe('FollowupCheckWorker', () => {
  it('outbound thread with no reply → creates an awaiting row', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    await seedMessage(db, {
      mailboxAccountId,
      threadId: 'thread-1',
      internalDate: new Date('2026-05-20T08:00:00Z'),
      isOutbound: true,
      recipients: ['boss@example.com'],
      subject: 'Q4 plans',
    });

    const worker = new FollowupCheckWorker({ db: db as never, now: () => NOW });
    const result = await worker.processJob(
      { scheduledAtMinute: followupCheckScheduledAtMinute(NOW) },
      FAKE_CTX,
    );

    expect(result.mailboxesProcessed).toBe(1);
    expect(result.awaitingUpserted).toBe(1);
    expect(result.repliedFlipped).toBe(0);

    const [row] = await db
      .select({
        providerThreadId: followupTracker.providerThreadId,
        recipientEmail: followupTracker.recipientEmail,
        subject: followupTracker.subject,
        sentAt: followupTracker.sentAt,
        status: followupTracker.status,
      })
      .from(followupTracker)
      .where(eq(followupTracker.mailboxAccountId, mailboxAccountId));
    expect(row).toBeDefined();
    expect(row!.providerThreadId).toBe('thread-1');
    expect(row!.recipientEmail).toBe('boss@example.com');
    expect(row!.subject).toBe('Q4 plans');
    expect(row!.status).toBe('awaiting');
  });

  it('bulk recipient (>5) thread is excluded per D86', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    await seedMessage(db, {
      mailboxAccountId,
      threadId: 'thread-bulk',
      internalDate: new Date('2026-05-20T08:00:00Z'),
      isOutbound: true,
      recipients: [
        'a@example.com',
        'b@example.com',
        'c@example.com',
        'd@example.com',
        'e@example.com',
        'f@example.com',
      ],
    });

    const worker = new FollowupCheckWorker({ db: db as never, now: () => NOW });
    const result = await worker.processJob(
      { scheduledAtMinute: followupCheckScheduledAtMinute(NOW) },
      FAKE_CTX,
    );
    expect(result.awaitingUpserted).toBe(0);

    const rows = await db.select({ id: followupTracker.id }).from(followupTracker);
    expect(rows).toHaveLength(0);
  });

  it('googlegroups.com recipient excluded per D86 mailing-list pattern', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    await seedMessage(db, {
      mailboxAccountId,
      threadId: 'thread-ml',
      internalDate: new Date('2026-05-20T08:00:00Z'),
      isOutbound: true,
      recipients: ['mylist@googlegroups.com'],
    });

    const worker = new FollowupCheckWorker({ db: db as never, now: () => NOW });
    const result = await worker.processJob(
      { scheduledAtMinute: followupCheckScheduledAtMinute(NOW) },
      FAKE_CTX,
    );
    expect(result.awaitingUpserted).toBe(0);
  });

  it('noreply@ recipient excluded per D86 automated-sender heuristic', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    await seedMessage(db, {
      mailboxAccountId,
      threadId: 'thread-noreply',
      internalDate: new Date('2026-05-20T08:00:00Z'),
      isOutbound: true,
      recipients: ['noreply@bigco.test'],
    });

    const worker = new FollowupCheckWorker({ db: db as never, now: () => NOW });
    const result = await worker.processJob(
      { scheduledAtMinute: followupCheckScheduledAtMinute(NOW) },
      FAKE_CTX,
    );
    expect(result.awaitingUpserted).toBe(0);
  });

  it('thread whose latest message is INBOUND (already replied) is excluded', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    await seedMessage(db, {
      mailboxAccountId,
      threadId: 'thread-replied',
      internalDate: new Date('2026-05-19T08:00:00Z'),
      isOutbound: true,
      recipients: ['boss@example.com'],
      idSuffix: 'replied-out',
    });
    await seedMessage(db, {
      mailboxAccountId,
      threadId: 'thread-replied',
      internalDate: new Date('2026-05-20T09:00:00Z'),
      isOutbound: false,
      recipients: null,
      idSuffix: 'replied-in',
    });

    const worker = new FollowupCheckWorker({ db: db as never, now: () => NOW });
    const result = await worker.processJob(
      { scheduledAtMinute: followupCheckScheduledAtMinute(NOW) },
      FAKE_CTX,
    );
    expect(result.awaitingUpserted).toBe(0);
  });

  it('existing awaiting row → flipped to replied once an inbound arrives', async () => {
    const db = await freshDb();
    const { workspaceId, mailboxAccountId } = await seedMailbox(db);
    // Seed an awaiting row directly (simulating a prior sweep).
    await db.insert(followupTracker).values({
      workspaceId,
      mailboxAccountId,
      providerThreadId: 'thread-x',
      recipientEmail: 'boss@example.com',
      subject: 'Q4 plans',
      sentAt: new Date('2026-05-19T08:00:00Z'),
      status: 'awaiting',
    });
    // Outbound message in the thread (matches the awaiting row).
    await seedMessage(db, {
      mailboxAccountId,
      threadId: 'thread-x',
      internalDate: new Date('2026-05-19T08:00:00Z'),
      isOutbound: true,
      recipients: ['boss@example.com'],
      idSuffix: 'x-out',
    });
    // Recipient has now replied (later inbound message).
    await seedMessage(db, {
      mailboxAccountId,
      threadId: 'thread-x',
      internalDate: new Date('2026-05-21T09:00:00Z'),
      isOutbound: false,
      recipients: null,
      idSuffix: 'x-in',
    });

    const worker = new FollowupCheckWorker({ db: db as never, now: () => NOW });
    const result = await worker.processJob(
      { scheduledAtMinute: followupCheckScheduledAtMinute(NOW) },
      FAKE_CTX,
    );
    expect(result.repliedFlipped).toBe(1);

    const [row] = await db
      .select({ status: followupTracker.status })
      .from(followupTracker)
      .where(
        and(
          eq(followupTracker.mailboxAccountId, mailboxAccountId),
          eq(followupTracker.providerThreadId, 'thread-x'),
        ),
      );
    expect(row!.status).toBe('replied');
  });

  it('idempotent: second run does not duplicate rows', async () => {
    const db = await freshDb();
    const { mailboxAccountId } = await seedMailbox(db);
    await seedMessage(db, {
      mailboxAccountId,
      threadId: 'thread-1',
      internalDate: new Date('2026-05-20T08:00:00Z'),
      isOutbound: true,
      recipients: ['boss@example.com'],
    });

    const worker = new FollowupCheckWorker({ db: db as never, now: () => NOW });
    await worker.processJob({ scheduledAtMinute: followupCheckScheduledAtMinute(NOW) }, FAKE_CTX);
    await worker.processJob({ scheduledAtMinute: followupCheckScheduledAtMinute(NOW) }, FAKE_CTX);

    const rows = await db
      .select({ id: followupTracker.id })
      .from(followupTracker)
      .where(eq(followupTracker.mailboxAccountId, mailboxAccountId));
    expect(rows).toHaveLength(1);
  });

  it('dismissed rows are NOT reopened by a later sweep', async () => {
    const db = await freshDb();
    const { workspaceId, mailboxAccountId } = await seedMailbox(db);
    // Pre-existing dismissed row.
    await db.insert(followupTracker).values({
      workspaceId,
      mailboxAccountId,
      providerThreadId: 'thread-d',
      recipientEmail: 'boss@example.com',
      subject: 'subj',
      sentAt: new Date('2026-05-19T08:00:00Z'),
      status: 'dismissed',
      dismissedAt: new Date('2026-05-19T10:00:00Z'),
    });
    // Outbound message that would otherwise match.
    await seedMessage(db, {
      mailboxAccountId,
      threadId: 'thread-d',
      internalDate: new Date('2026-05-19T08:00:00Z'),
      isOutbound: true,
      recipients: ['boss@example.com'],
    });

    const worker = new FollowupCheckWorker({ db: db as never, now: () => NOW });
    await worker.processJob({ scheduledAtMinute: followupCheckScheduledAtMinute(NOW) }, FAKE_CTX);

    const [row] = await db
      .select({ status: followupTracker.status })
      .from(followupTracker)
      .where(eq(followupTracker.providerThreadId, 'thread-d'));
    expect(row!.status).toBe('dismissed');
  });

  it('idempotency key shape matches D225 cron contract', () => {
    const worker = new FollowupCheckWorker({ db: {} as never });
    type WithProtectedKey = FollowupCheckWorker & {
      getIdempotencyKey?: (payload: { scheduledAtMinute: string }) => string;
    };
    const key = (worker as WithProtectedKey).getIdempotencyKey?.({
      scheduledAtMinute: '2026-05-25T08:00',
    });
    expect(key).toBe('FollowupCheckWorker:2026-05-25T08:00');
  });
});
