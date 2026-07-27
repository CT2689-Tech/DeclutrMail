import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  actionJobs,
  activityLog,
  mailMessages,
  mailboxAccounts,
  schema,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import {
  LabelActionWorker,
  OutboxPublisher,
  PASSTHROUGH_MAILBOX_LOCK,
  type GmailMutationAccess,
  type GmailMutationClient,
  type WorkerContext,
} from '@declutrmail/workers';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { ActionsService } from './actions.service.js';

/**
 * Preview ↔ execution contract across the WHOLE pipeline (D226 —
 * 2026-07-26 finding 5.5). Real ActionsService + real LabelActionWorker
 * against ONE PGlite: the number the preview showed must be the number
 * enqueue stamps (`requestedCount`), the worker resolves, and the
 * receipt (`affectedCount` + activity row) reports — including the
 * inbound-only rule that keeps self-sent SENT+INBOX mail untouched.
 */

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'migrations',
);

type Db = ReturnType<typeof drizzle<typeof schema>>;

const SENDER_KEY = 'd'.repeat(64);

async function freshDb(): Promise<Db> {
  const pg = new PGlite({ extensions: { citext } });
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) await pg.query(trimmed);
    }
  }
  return drizzle(pg, { schema });
}

async function seedMailbox(db: Db): Promise<string> {
  const [ws] = await db.insert(workspaces).values({ name: 'WS' }).returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'o@declutrmail.ai' })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({ workspaceId: ws!.id, userId: user!.id, provider: 'gmail', providerAccountId: 'o@x' })
    .returning({ id: mailboxAccounts.id });
  return mailbox!.id;
}

async function seedSender(db: Db, mailboxAccountId: string): Promise<string> {
  const [s] = await db
    .insert(senders)
    .values({
      mailboxAccountId,
      senderKey: SENDER_KEY,
      email: 'news@shop.example',
      domain: 'shop.example',
      gmailCategory: 'promotions',
      firstSeenAt: new Date('2026-01-01'),
      lastSeenAt: new Date('2026-05-01'),
    })
    .returning({ id: senders.id });
  return s!.id;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

async function seedMessage(
  db: Db,
  mailboxAccountId: string,
  pid: string,
  labels: string[],
  internalDate: Date,
  isOutbound = false,
): Promise<void> {
  await db.insert(mailMessages).values({
    mailboxAccountId,
    providerMessageId: pid,
    providerThreadId: `t-${pid}`,
    senderKey: SENDER_KEY,
    internalDate,
    isUnread: false,
    labelIds: labels,
    isOutbound,
  });
}

/** Records batchModify calls; never talks to Gmail. */
class FakeMutationClient implements GmailMutationClient {
  calls: { ids: string[] }[] = [];
  async modifyLabels(): Promise<void> {}
  async batchModify(messageIds: string[]): Promise<void> {
    this.calls.push({ ids: [...messageIds] });
  }
  async ensureLabelId(name: string): Promise<string> {
    return `Label_${name}`;
  }
}

const CTX: WorkerContext = {
  jobId: 'job-1',
  workerName: 'LabelActionWorker',
  attempt: 1,
  maxAttempts: 5,
  startedAt: new Date(),
  policy: 'perMailboxPolicy',
};

describe('action pipeline contract — preview == enqueue == worker == receipt', () => {
  let db: Db;
  let mailboxId: string;
  let senderId: string;
  let svc: ActionsService;
  let gmail: FakeMutationClient;
  let worker: LabelActionWorker;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db);
    senderId = await seedSender(db, mailboxId);
    const queue = { add: async () => {}, getJob: async () => null };
    svc = new ActionsService(db as never, queue as never);
    gmail = new FakeMutationClient();
    const access: GmailMutationAccess = { getClient: async () => gmail };
    worker = new LabelActionWorker({
      db: db as never,
      gmailMutation: access,
      outbox: new OutboxPublisher(),
      lock: PASSTHROUGH_MAILBOX_LOCK,
    });
  });

  it('agrees end-to-end on a mixed inbound/outbound mailbox, with and without a window', async () => {
    // The scenario from finding 5.5: inbound inbox mail in and out of the
    // window, self-CC mail carrying SENT + INBOX, outbound-only mail, and
    // an archived row.
    await seedMessage(db, mailboxId, 'in-recent', ['INBOX'], daysAgo(10));
    await seedMessage(db, mailboxId, 'in-old', ['INBOX'], daysAgo(400));
    await seedMessage(db, mailboxId, 'self-cc', ['SENT', 'INBOX'], daysAgo(5), true);
    await seedMessage(db, mailboxId, 'sent-only', ['SENT'], daysAgo(5), true);
    await seedMessage(db, mailboxId, 'archived', ['CATEGORY_PROMOTIONS'], daysAgo(20));

    const preview = await svc.previewComposite({ mailboxAccountId: mailboxId, senderId });
    expect(preview.counts.all).toBe(2);
    expect(preview.counts.olderThan365d).toBe(1);

    // Whole-inbox archive: preview == requested == resolved == receipt.
    const all = await svc.enqueueComposite({
      mailboxAccountId: mailboxId,
      selector: { type: 'sender', senderId },
      primary: { type: 'archive' },
      idempotencyKey: 'chain-all',
      override: false,
    });
    expect(all.primaryCount).toBe(preview.counts.all);

    const allRun = await worker.processJob(
      { actionId: all.actionId, mailboxAccountId: mailboxId, idempotencyKey: 'archive-chain-all' },
      CTX,
    );
    expect(gmail.calls[0]!.ids.sort()).toEqual(['in-old', 'in-recent']);
    expect(allRun.affectedCount).toBe(preview.counts.all);

    const [allRow] = await db.select().from(actionJobs).where(eq(actionJobs.id, all.actionId));
    expect(allRow!.requestedCount).toBe(preview.counts.all);
    expect(allRow!.affectedCount).toBe(preview.counts.all);
    expect(allRow!.resolvedMessageIds.sort()).toEqual(['in-old', 'in-recent']);

    const activity = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.mailboxAccountId, mailboxId));
    expect(activity[0]!.affectedCount).toBe(preview.counts.all);

    // Windowed archive on a fresh equivalent mailbox state: the 365d
    // bucket the chip row showed is exactly what the worker moves.
    // (`in-recent`/`in-old` were archived above, so re-seed.)
    await seedMessage(db, mailboxId, 'w-in-recent', ['INBOX'], daysAgo(10));
    await seedMessage(db, mailboxId, 'w-in-old', ['INBOX'], daysAgo(400));
    await seedMessage(db, mailboxId, 'w-self-old', ['SENT', 'INBOX'], daysAgo(400), true);

    const windowedPreview = await svc.previewComposite({ mailboxAccountId: mailboxId, senderId });
    expect(windowedPreview.counts.olderThan365d).toBe(1);

    const windowed = await svc.enqueueComposite({
      mailboxAccountId: mailboxId,
      selector: { type: 'sender', senderId },
      primary: { type: 'archive', olderThanDays: 365 },
      idempotencyKey: 'chain-365',
      override: false,
    });
    expect(windowed.primaryCount).toBe(windowedPreview.counts.olderThan365d);

    const windowedRun = await worker.processJob(
      {
        actionId: windowed.actionId,
        mailboxAccountId: mailboxId,
        idempotencyKey: 'archive-chain-365',
      },
      CTX,
    );
    expect(gmail.calls[1]!.ids).toEqual(['w-in-old']);
    expect(windowedRun.affectedCount).toBe(windowedPreview.counts.olderThan365d);
  });
});
