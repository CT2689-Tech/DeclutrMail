import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  actionJobs,
  actionRecoveryPreviews,
  mailMessages,
  mailboxAccounts,
  schema,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  GmailAccess,
  GmailHistoryPage,
  GmailMessageListPage,
  GmailMessageMetadata,
  GmailMetadataClient,
} from './ports.js';
import { ActionRecoveryWorker, type ActionRecoveryJobData } from './action-recovery.worker.js';
import { InvalidGrantError, PermanentError, TransientError } from './worker-errors.js';
import type { WorkerContext } from './worker-context.js';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');
const NOW = new Date('2026-07-14T12:00:00.000Z');
const SENDER_KEY = 'a'.repeat(64);

type Db = ReturnType<typeof drizzle<typeof schema>>;

async function freshDb(): Promise<Db> {
  const pg = new PGlite({ extensions: { citext } });
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const migration = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) await pg.query(statement.trim());
    }
  }
  return drizzle(pg, { schema });
}

async function seedMailbox(db: Db): Promise<{ mailboxId: string; senderId: string }> {
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'Recovery test' })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: workspace!.id, email: 'owner@example.com' })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: workspace!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: 'owner@example.com',
    })
    .returning({ id: mailboxAccounts.id });
  const [sender] = await db
    .insert(senders)
    .values({
      mailboxAccountId: mailbox!.id,
      senderKey: SENDER_KEY,
      email: 'news@example.com',
      domain: 'example.com',
      gmailCategory: 'promotions',
      firstSeenAt: new Date('2026-01-01T00:00:00Z'),
      lastSeenAt: NOW,
    })
    .returning({ id: senders.id });
  return { mailboxId: mailbox!.id, senderId: sender!.id };
}

async function seedAction(
  db: Db,
  input: {
    mailboxId: string;
    senderId: string;
    verb?: 'archive' | 'later' | 'delete';
    resolvedMessageIds?: string[];
    errorCode?: string;
    olderThanDays?: number | null;
  },
): Promise<{ actionId: string; previewId: string }> {
  const verb = input.verb ?? 'archive';
  const [action] = await db
    .insert(actionJobs)
    .values({
      mailboxAccountId: input.mailboxId,
      verb,
      direction: 'forward',
      selector: { type: 'sender', senderId: input.senderId, senderKey: SENDER_KEY },
      resolvedMessageIds: input.resolvedMessageIds ?? [],
      requestedCount: input.resolvedMessageIds?.length ?? 0,
      status: 'failed',
      errorCode: input.errorCode ?? 'TransientError',
      idempotencyKey: `recovery-test-${crypto.randomUUID()}`,
      olderThanDays: input.olderThanDays ?? null,
      ...(verb === 'later' ? { wakeAt: new Date('2026-07-21T12:00:00Z') } : {}),
    })
    .returning({ id: actionJobs.id });
  const [preview] = await db
    .insert(actionRecoveryPreviews)
    .values({
      mailboxAccountId: input.mailboxId,
      rootActionId: action!.id,
      currentActionId: action!.id,
      expiresAt: new Date(NOW.getTime() + 15 * 60 * 1000),
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning({ id: actionRecoveryPreviews.id });
  return { actionId: action!.id, previewId: preview!.id };
}

async function seedLocalMessage(
  db: Db,
  mailboxId: string,
  id: string,
  labelIds: string[],
  internalDate = new Date('2026-05-01T00:00:00Z'),
): Promise<void> {
  await db.insert(mailMessages).values({
    mailboxAccountId: mailboxId,
    providerMessageId: id,
    providerThreadId: `thread-${id}`,
    senderKey: SENDER_KEY,
    internalDate,
    labelIds,
    isUnread: false,
  });
}

function message(id: string, labelIds: string[]): GmailMessageMetadata {
  return {
    id,
    threadId: `thread-${id}`,
    labelIds,
    snippet: '',
    internalDate: String(NOW.getTime()),
    from: null,
    subject: null,
    to: null,
    cc: null,
    listUnsubscribe: null,
    listUnsubscribePost: null,
  };
}

class FakeMetadataClient implements GmailMetadataClient {
  readonly messages = new Map<string, GmailMessageMetadata | null>();
  readonly calls: string[] = [];
  readonly labelCalls: string[] = [];
  error: Error | null = null;
  labelError: Error | null = null;
  laterLabelId: string | null = 'Label_Later';

  async getMessageMetadata(id: string): Promise<GmailMessageMetadata | null> {
    if (this.error) throw this.error;
    return this.messages.get(id) ?? null;
  }
  async getMessageLabelIds(id: string): Promise<string[] | null> {
    this.calls.push(id);
    if (this.error) throw this.error;
    return this.messages.get(id)?.labelIds ?? null;
  }
  async listMessageIds(): Promise<GmailMessageListPage> {
    return { ids: [] };
  }
  async findLabelId(name: string): Promise<string | null> {
    this.labelCalls.push(name);
    if (this.labelError) throw this.labelError;
    return this.laterLabelId;
  }
  async getProfile(): Promise<{ historyId: string }> {
    return { historyId: '1' };
  }
  async listHistory(): Promise<GmailHistoryPage | null> {
    return null;
  }
}

function metadataAccess(client: GmailMetadataClient): GmailAccess {
  return { getClient: async () => client };
}

const CTX: WorkerContext = {
  jobId: 'preview-job',
  workerName: 'ActionRecoveryWorker',
  attempt: 1,
  maxAttempts: 5,
  startedAt: NOW,
  policy: 'perMailboxPolicy',
};

describe('ActionRecoveryWorker', () => {
  let db: Db;
  let mailboxId: string;
  let senderId: string;
  let gmail: FakeMetadataClient;
  let worker: ActionRecoveryWorker;

  beforeEach(async () => {
    db = await freshDb();
    ({ mailboxId, senderId } = await seedMailbox(db));
    gmail = new FakeMetadataClient();
    worker = new ActionRecoveryWorker({
      db: db as never,
      gmail: metadataAccess(gmail),
      now: () => NOW,
    });
  });

  it('excludes missing messages from a partial archive confirmation target', async () => {
    const ids = ['already', 'remaining', 'missing'];
    const seeded = await seedAction(db, {
      mailboxId,
      senderId,
      resolvedMessageIds: ids,
    });
    gmail.messages.set('already', message('already', ['CATEGORY_PROMOTIONS']));
    gmail.messages.set('remaining', message('remaining', ['INBOX']));
    gmail.messages.set('missing', null);

    const result = await worker.processJob({ ...seeded, mailboxAccountId: mailboxId }, CTX);
    const [preview] = await db
      .select()
      .from(actionRecoveryPreviews)
      .where(eq(actionRecoveryPreviews.id, seeded.previewId));

    expect(result).toMatchObject({
      outcome: 'partial',
      targetCount: 2,
      remainingCount: 1,
      verifiedCount: 2,
      unavailableCount: 1,
      alreadyDone: false,
    });
    expect(preview).toMatchObject({
      status: 'ready',
      outcome: 'partial',
      targetMessageIds: ['already', 'remaining'],
      remainingMessageIds: ['remaining'],
      verifiedCount: 2,
      unavailableCount: 1,
    });
  });

  it('consumes an all-missing provider target as no-change-needed', async () => {
    const seeded = await seedAction(db, {
      mailboxId,
      senderId,
      resolvedMessageIds: ['missing-1', 'missing-2'],
    });
    gmail.messages.set('missing-1', null);
    gmail.messages.set('missing-2', null);

    const result = await worker.processJob({ ...seeded, mailboxAccountId: mailboxId }, CTX);
    const [preview] = await db
      .select()
      .from(actionRecoveryPreviews)
      .where(eq(actionRecoveryPreviews.id, seeded.previewId));

    expect(result).toMatchObject({
      outcome: 'no_change_needed',
      targetCount: 0,
      remainingCount: 0,
      verifiedCount: 0,
      unavailableCount: 2,
    });
    expect(preview).toMatchObject({
      status: 'consumed',
      outcome: 'no_change_needed',
      targetMessageIds: [],
      remainingMessageIds: [],
      verifiedCount: 0,
      unavailableCount: 2,
    });
  });

  it('resolves and freezes the current local INBOX/window for an unresolved sender action', async () => {
    await seedLocalMessage(db, mailboxId, 'old-inbox', ['INBOX']);
    await seedLocalMessage(db, mailboxId, 'old-archived', []);
    await seedLocalMessage(db, mailboxId, 'new-inbox', ['INBOX'], new Date('2026-07-10T00:00:00Z'));
    const seeded = await seedAction(db, {
      mailboxId,
      senderId,
      resolvedMessageIds: [],
      olderThanDays: 30,
    });
    gmail.messages.set('old-inbox', message('old-inbox', ['INBOX']));

    const result = await worker.processJob({ ...seeded, mailboxAccountId: mailboxId }, CTX);
    const [preview] = await db
      .select()
      .from(actionRecoveryPreviews)
      .where(eq(actionRecoveryPreviews.id, seeded.previewId));

    expect(result.outcome).toBe('not_applied');
    expect(preview?.targetMessageIds).toEqual(['old-inbox']);
    expect(preview?.remainingMessageIds).toEqual(['old-inbox']);
    expect(gmail.calls).toEqual(['old-inbox']);
  });

  it('uses the resolved Later label and requires both Later-present and INBOX-absent', async () => {
    const seeded = await seedAction(db, {
      mailboxId,
      senderId,
      verb: 'later',
      resolvedMessageIds: ['later-ok', 'still-inbox'],
    });
    gmail.messages.set('later-ok', message('later-ok', ['Label_Later']));
    gmail.messages.set('still-inbox', message('still-inbox', ['INBOX', 'Label_Later']));

    const result = await worker.processJob({ ...seeded, mailboxAccountId: mailboxId }, CTX);

    expect(result.outcome).toBe('partial');
    expect(gmail.labelCalls).toEqual(['DeclutrMail/Later']);
  });

  it('treats an absent Later label as not applied without creating it', async () => {
    const seeded = await seedAction(db, {
      mailboxId,
      senderId,
      verb: 'later',
      resolvedMessageIds: ['message-without-later'],
    });
    gmail.laterLabelId = null;
    gmail.messages.set('message-without-later', message('message-without-later', []));

    const result = await worker.processJob({ ...seeded, mailboxAccountId: mailboxId }, CTX);

    expect(result.outcome).toBe('not_applied');
    expect(gmail.labelCalls).toEqual(['DeclutrMail/Later']);
  });

  it('freshly verifies an old revoked-grant failure after credentials recover', async () => {
    const seeded = await seedAction(db, {
      mailboxId,
      senderId,
      resolvedMessageIds: ['m1'],
      errorCode: 'InvalidGrantError',
    });
    gmail.messages.set('m1', message('m1', ['INBOX']));

    const result = await worker.processJob({ ...seeded, mailboxAccountId: mailboxId }, CTX);
    const [preview] = await db
      .select()
      .from(actionRecoveryPreviews)
      .where(eq(actionRecoveryPreviews.id, seeded.previewId));

    expect(result.outcome).toBe('not_applied');
    expect(preview).toMatchObject({
      status: 'ready',
      outcome: 'not_applied',
      errorCode: null,
    });
    expect(gmail.calls).toEqual(['m1']);
  });

  it('classifies provider reauthentication and permanent verification failures', async () => {
    const reauth = await seedAction(db, {
      mailboxId,
      senderId,
      resolvedMessageIds: ['reauth'],
    });
    gmail.error = new InvalidGrantError('revoked');
    await expect(
      worker.processJob({ ...reauth, mailboxAccountId: mailboxId }, CTX),
    ).resolves.toMatchObject({ outcome: 'reconnect_required' });

    // Complete previews are unique per root only, so a separate root can
    // immediately verify the permanent branch in the same mailbox.
    gmail.error = null;
    const blocked = await seedAction(db, {
      mailboxId,
      senderId,
      verb: 'later',
      resolvedMessageIds: ['bad-label'],
    });
    gmail.labelError = new PermanentError('invalid label');
    await expect(
      worker.processJob({ ...blocked, mailboxAccountId: mailboxId }, CTX),
    ).resolves.toMatchObject({ outcome: 'blocked' });
  });

  it('consumes an empty target as no-change-needed without calling Gmail', async () => {
    const seeded = await seedAction(db, { mailboxId, senderId, resolvedMessageIds: [] });

    const result = await worker.processJob({ ...seeded, mailboxAccountId: mailboxId }, CTX);
    const [preview] = await db
      .select()
      .from(actionRecoveryPreviews)
      .where(eq(actionRecoveryPreviews.id, seeded.previewId));

    expect(result.outcome).toBe('no_change_needed');
    expect(preview).toMatchObject({ status: 'consumed', outcome: 'no_change_needed' });
    expect(gmail.calls).toEqual([]);
  });

  it('returns a ready preview idempotently without re-reading provider state', async () => {
    const seeded = await seedAction(db, {
      mailboxId,
      senderId,
      resolvedMessageIds: ['m1'],
    });
    gmail.messages.set('m1', message('m1', ['INBOX']));
    const payload = { ...seeded, mailboxAccountId: mailboxId };

    await worker.processJob(payload, CTX);
    gmail.calls.length = 0;
    const replay = await worker.processJob(payload, CTX);

    expect(replay).toMatchObject({ outcome: 'not_applied', alreadyDone: true });
    expect(gmail.calls).toEqual([]);
  });

  it('records uncertain only after transient verification exhausts the queue budget', async () => {
    const seeded = await seedAction(db, {
      mailboxId,
      senderId,
      resolvedMessageIds: ['m1'],
    });
    gmail.error = new TransientError('provider unavailable');
    const payload: ActionRecoveryJobData = { ...seeded, mailboxAccountId: mailboxId };

    await expect(
      worker.run({
        id: 'action-recovery-final',
        queueName: 'action-recovery',
        data: payload,
        attemptsMade: 4,
      } as never),
    ).rejects.toThrow('provider unavailable');
    const [preview] = await db
      .select()
      .from(actionRecoveryPreviews)
      .where(eq(actionRecoveryPreviews.id, seeded.previewId));

    expect(preview).toMatchObject({
      status: 'failed',
      outcome: 'uncertain',
      errorCode: 'TransientError',
    });
  });
});
