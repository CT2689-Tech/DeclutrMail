import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  actionJobs,
  actionRecoveryPreviews,
  mailboxAccounts,
  schema,
  senderPolicies,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { ActionRecoveryService } from './action-recovery.service.js';

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
type FakeQueue = ReturnType<typeof fakeQueue>;

async function freshDb(): Promise<Db> {
  const pg = new PGlite({ extensions: { citext } });
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const migration = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) await pg.query(statement.trim());
    }
  }
  return drizzle(pg, { schema });
}

function fakeQueue(options: { fail?: boolean } = {}) {
  const queue = {
    fail: options.fail ?? false,
    calls: [] as Array<{ name: string; data: unknown; jobId: string | undefined }>,
    add: async (name: string, data: unknown, jobOptions: { jobId?: string }) => {
      if (queue.fail) throw new Error('redis unavailable');
      if (jobOptions.jobId && queue.calls.some((call) => call.jobId === jobOptions.jobId)) return;
      queue.calls.push({ name, data, jobId: jobOptions.jobId });
    },
  };
  return queue;
}

async function seedMailbox(db: Db, suffix = 'one') {
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `Workspace ${suffix}` })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: workspace!.id, email: `${suffix}@declutrmail.ai` })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: workspace!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: `${suffix}@gmail.test`,
    })
    .returning({ id: mailboxAccounts.id });
  const senderKey = 'a'.repeat(64);
  const [sender] = await db
    .insert(senders)
    .values({
      mailboxAccountId: mailbox!.id,
      senderKey,
      email: `news-${suffix}@example.test`,
      domain: 'example.test',
      gmailCategory: 'promotions',
      firstSeenAt: new Date('2026-01-01T00:00:00Z'),
      lastSeenAt: new Date('2026-07-01T00:00:00Z'),
    })
    .returning({ id: senders.id });
  return { mailboxId: mailbox!.id, senderId: sender!.id, senderKey };
}

async function seedFailedAction(
  db: Db,
  mailbox: Awaited<ReturnType<typeof seedMailbox>>,
  input: {
    key: string;
    verb?: 'archive' | 'later' | 'delete' | 'unsubscribe';
    ids?: string[];
    wakeAt?: Date;
  },
) {
  const verb = input.verb ?? 'archive';
  const [action] = await db
    .insert(actionJobs)
    .values({
      mailboxAccountId: mailbox.mailboxId,
      verb,
      direction: 'forward',
      selector: {
        type: 'sender',
        senderId: mailbox.senderId,
        senderKey: mailbox.senderKey,
      },
      resolvedMessageIds: input.ids ?? ['gmail-1', 'gmail-2'],
      requestedCount: input.ids?.length ?? 2,
      status: 'failed',
      errorCode: 'TransientError',
      idempotencyKey: input.key,
      ...(verb === 'later' ? { wakeAt: input.wakeAt ?? new Date('2026-07-01T00:00:00Z') } : {}),
    })
    .returning();
  return action!;
}

async function makeReady(
  db: Db,
  previewId: string,
  input: {
    outcome?: 'not_applied' | 'partial' | 'already_applied';
    target?: string[];
    remaining?: string[];
  } = {},
) {
  const target = input.target ?? ['gmail-1', 'gmail-2'];
  const remaining = input.remaining ?? target;
  const [preview] = await db
    .update(actionRecoveryPreviews)
    .set({
      status: 'ready',
      outcome: input.outcome ?? 'not_applied',
      targetMessageIds: target,
      remainingMessageIds: remaining,
      verifiedCount: target.length,
      verifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(actionRecoveryPreviews.id, previewId))
    .returning();
  return preview!;
}

function errorCode(error: unknown): unknown {
  if (!error || typeof error !== 'object' || !('getResponse' in error)) return null;
  const response = (error as { getResponse(): unknown }).getResponse();
  return response && typeof response === 'object' && 'code' in response
    ? (response as { code: unknown }).code
    : null;
}

describe('ActionRecoveryService', () => {
  let db: Db;
  let mailbox: Awaited<ReturnType<typeof seedMailbox>>;
  let actionQueue: FakeQueue;
  let recoveryQueue: FakeQueue;
  let service: ActionRecoveryService;

  beforeEach(async () => {
    db = await freshDb();
    mailbox = await seedMailbox(db);
    actionQueue = fakeQueue();
    recoveryQueue = fakeQueue();
    service = new ActionRecoveryService(db as never, actionQueue as never, recoveryQueue as never);
  });

  it('deduplicates repeated Review clicks into one durable verification', async () => {
    const action = await seedFailedAction(db, mailbox, { key: 'original-review' });

    const [first, replay] = await Promise.all([
      service.createPreview({
        mailboxAccountId: mailbox.mailboxId,
        actionId: action.id,
      }),
      service.createPreview({
        mailboxAccountId: mailbox.mailboxId,
        actionId: action.id,
      }),
    ]);

    expect(replay.previewId).toBe(first.previewId);
    expect(recoveryQueue.calls).toHaveLength(1);
    expect(await db.select().from(actionRecoveryPreviews)).toHaveLength(1);
  });

  it('confirmation creates one linked immutable attempt and HTTP replay returns it', async () => {
    const original = await seedFailedAction(db, mailbox, { key: 'original-confirm' });
    const preview = await service.createPreview({
      mailboxAccountId: mailbox.mailboxId,
      actionId: original.id,
    });
    await makeReady(db, preview.previewId, {
      outcome: 'partial',
      target: ['gmail-1', 'gmail-2'],
      remaining: ['gmail-2'],
    });

    const first = await service.confirmPreview({
      mailboxAccountId: mailbox.mailboxId,
      previewId: preview.previewId,
      idempotencyKey: 'confirm-once',
      wakeAt: null,
    });
    const replay = await service.confirmPreview({
      mailboxAccountId: mailbox.mailboxId,
      previewId: preview.previewId,
      idempotencyKey: 'confirm-once',
      wakeAt: null,
    });

    expect(replay).toMatchObject({ actionId: first.actionId, replayed: true });
    expect(actionQueue.calls).toHaveLength(1);
    const [child] = await db.select().from(actionJobs).where(eq(actionJobs.id, first.actionId));
    expect(child).toMatchObject({
      rootActionId: original.id,
      retryOfActionId: original.id,
      recoveryAttempt: 1,
      status: 'queued',
      resolvedMessageIds: ['gmail-1', 'gmail-2'],
    });
    const [storedPreview] = await db
      .select()
      .from(actionRecoveryPreviews)
      .where(eq(actionRecoveryPreviews.id, preview.previewId));
    expect(storedPreview).toMatchObject({ status: 'consumed', recoveryActionId: first.actionId });
  });

  it('already-applied Gmail state is still reconciled to repair Activity and Undo', async () => {
    const original = await seedFailedAction(db, mailbox, { key: 'original-applied' });
    const preview = await service.createPreview({
      mailboxAccountId: mailbox.mailboxId,
      actionId: original.id,
    });
    await makeReady(db, preview.previewId, {
      outcome: 'already_applied',
      target: ['gmail-1', 'gmail-2'],
      remaining: [],
    });

    const result = await service.confirmPreview({
      mailboxAccountId: mailbox.mailboxId,
      previewId: preview.previewId,
      idempotencyKey: 'confirm-applied',
      wakeAt: null,
    });
    const [child] = await db.select().from(actionJobs).where(eq(actionJobs.id, result.actionId));

    expect(child!.resolvedMessageIds).toEqual(['gmail-1', 'gmail-2']);
    expect(actionQueue.calls).toHaveLength(1);
  });

  it('a second confirmation key cannot create another child for a consumed preview', async () => {
    const original = await seedFailedAction(db, mailbox, { key: 'original-second-key' });
    const preview = await service.createPreview({
      mailboxAccountId: mailbox.mailboxId,
      actionId: original.id,
    });
    await makeReady(db, preview.previewId);
    await service.confirmPreview({
      mailboxAccountId: mailbox.mailboxId,
      previewId: preview.previewId,
      idempotencyKey: 'confirm-first',
      wakeAt: null,
    });

    const error = await service
      .confirmPreview({
        mailboxAccountId: mailbox.mailboxId,
        previewId: preview.previewId,
        idempotencyKey: 'confirm-second',
        wakeAt: null,
      })
      .catch((caught: unknown) => caught);

    expect(errorCode(error)).toBe('RECOVERY_ALREADY_REQUESTED');
    const attempts = await db.select().from(actionJobs);
    expect(attempts).toHaveLength(2);
  });

  it('concurrent confirmation replays return the same winning child', async () => {
    const original = await seedFailedAction(db, mailbox, { key: 'original-concurrent' });
    const preview = await service.createPreview({
      mailboxAccountId: mailbox.mailboxId,
      actionId: original.id,
    });
    await makeReady(db, preview.previewId);

    const input = {
      mailboxAccountId: mailbox.mailboxId,
      previewId: preview.previewId,
      idempotencyKey: 'confirm-concurrent',
      wakeAt: null,
    };
    const [first, second] = await Promise.all([
      service.confirmPreview(input),
      service.confirmPreview(input),
    ]);

    expect(second.actionId).toBe(first.actionId);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(actionQueue.calls).toHaveLength(1);
  });

  it('keeps an ambiguously enqueued child queued and heals it on request replay', async () => {
    const original = await seedFailedAction(db, mailbox, { key: 'original-enqueue-ack' });
    const preview = await service.createPreview({
      mailboxAccountId: mailbox.mailboxId,
      actionId: original.id,
    });
    await makeReady(db, preview.previewId);
    actionQueue.fail = true;

    await expect(
      service.confirmPreview({
        mailboxAccountId: mailbox.mailboxId,
        previewId: preview.previewId,
        idempotencyKey: 'confirm-enqueue-ack',
        wakeAt: null,
      }),
    ).rejects.toMatchObject({ status: 503 });
    const [queued] = await db
      .select()
      .from(actionJobs)
      .where(eq(actionJobs.idempotencyKey, `recovery-${createHashForTest('confirm-enqueue-ack')}`));
    expect(queued?.status).toBe('queued');

    actionQueue.fail = false;
    const replay = await service.confirmPreview({
      mailboxAccountId: mailbox.mailboxId,
      previewId: preview.previewId,
      idempotencyKey: 'confirm-enqueue-ack',
      wakeAt: null,
    });
    expect(replay).toMatchObject({ actionId: queued!.id, replayed: true, status: 'queued' });
    expect(actionQueue.calls).toHaveLength(1);
  });

  it('an expired Later schedule requires a new future time and rejects a newer active timer', async () => {
    const original = await seedFailedAction(db, mailbox, {
      key: 'original-later',
      verb: 'later',
      wakeAt: new Date('2026-07-01T00:00:00Z'),
    });
    const preview = await service.createPreview({
      mailboxAccountId: mailbox.mailboxId,
      actionId: original.id,
    });
    await makeReady(db, preview.previewId);

    const missing = await service
      .confirmPreview({
        mailboxAccountId: mailbox.mailboxId,
        previewId: preview.previewId,
        idempotencyKey: 'confirm-later-missing',
        wakeAt: null,
      })
      .catch((caught: unknown) => caught);
    expect(errorCode(missing)).toBe('LATER_WAKE_TIME_REQUIRED');

    await db.insert(senderPolicies).values({
      mailboxAccountId: mailbox.mailboxId,
      senderKey: mailbox.senderKey,
      policyType: 'later',
      snoozedUntil: new Date('2099-08-01T00:00:00Z'),
    });
    const superseded = await service
      .confirmPreview({
        mailboxAccountId: mailbox.mailboxId,
        previewId: preview.previewId,
        idempotencyKey: 'confirm-later-future',
        wakeAt: new Date('2099-07-20T00:00:00Z'),
      })
      .catch((caught: unknown) => caught);
    expect(errorCode(superseded)).toBe('LATER_TIMER_SUPERSEDED');
    expect(actionQueue.calls).toHaveLength(0);

    await db
      .update(senderPolicies)
      .set({ snoozedUntil: new Date('2026-07-01T00:00:00Z') })
      .where(eq(senderPolicies.mailboxAccountId, mailbox.mailboxId));
    const recovered = await service.confirmPreview({
      mailboxAccountId: mailbox.mailboxId,
      previewId: preview.previewId,
      idempotencyKey: 'confirm-later-after-stale-timer',
      wakeAt: new Date('2099-07-20T00:00:00Z'),
    });
    expect(recovered.status).toBe('queued');
  });

  it('binds a Later idempotency key to omission versus explicit wake time', async () => {
    const original = await seedFailedAction(db, mailbox, {
      key: 'original-later-fingerprint',
      verb: 'later',
      wakeAt: new Date('2099-07-20T00:00:00Z'),
    });
    const preview = await service.createPreview({
      mailboxAccountId: mailbox.mailboxId,
      actionId: original.id,
    });
    await makeReady(db, preview.previewId);
    await service.confirmPreview({
      mailboxAccountId: mailbox.mailboxId,
      previewId: preview.previewId,
      idempotencyKey: 'confirm-later-fingerprint',
      wakeAt: new Date('2099-07-20T00:00:00Z'),
    });

    const error = await service
      .confirmPreview({
        mailboxAccountId: mailbox.mailboxId,
        previewId: preview.previewId,
        idempotencyKey: 'confirm-later-fingerprint',
        wakeAt: null,
      })
      .catch((caught: unknown) => caught);
    expect(errorCode(error)).toBe('IDEMPOTENCY_KEY_CONFLICT');
  });

  it('never offers generic recovery for unsubscribe execution', async () => {
    const action = await seedFailedAction(db, mailbox, {
      key: 'original-unsubscribe',
      verb: 'unsubscribe',
      ids: [],
    });
    const error = await service
      .createPreview({ mailboxAccountId: mailbox.mailboxId, actionId: action.id })
      .catch((caught: unknown) => caught);

    expect(errorCode(error)).toBe('ACTION_NOT_RECOVERABLE');
    expect(recoveryQueue.calls).toHaveLength(0);
  });
});

function createHashForTest(value: string): string {
  // Keep the storage-key assertion independent of private service methods.
  return createHash('sha256').update(value).digest('hex');
}
