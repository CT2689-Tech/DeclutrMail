import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  actionJobs,
  mailMessages,
  mailboxAccounts,
  schema,
  senderPolicies,
  senders,
  undoJournal,
  users,
  workspaces,
} from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { ActionsService } from './actions.service.js';

/**
 * ActionsService integration tests (D226).
 *
 * Real service against in-process PGlite — covers ownership-scoped
 * resolution, the protected-sender gate, client-key idempotency, the
 * messages-selector forged-id drop, and the queue-unavailable path. The
 * BullMQ queue is faked (counts enqueues); the worker is tested
 * separately.
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

const SENDER_KEY = 'b'.repeat(64);

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

async function seedMessage(
  db: Db,
  mailboxAccountId: string,
  pid: string,
  labels: string[],
): Promise<void> {
  await db.insert(mailMessages).values({
    mailboxAccountId,
    providerMessageId: pid,
    providerThreadId: `t-${pid}`,
    senderKey: SENDER_KEY,
    internalDate: new Date('2026-05-01'),
    isUnread: false,
    labelIds: labels,
  });
}

/** Fake BullMQ queue — records enqueues. */
function fakeQueue() {
  const q = {
    count: 0,
    jobIds: [] as string[],
    add: async (_job: unknown, _data: unknown, opts: { jobId?: string }) => {
      q.count += 1;
      if (opts?.jobId) q.jobIds.push(opts.jobId);
    },
  };
  return q;
}

describe('ActionsService', () => {
  let db: Db;
  let mailboxId: string;
  let senderId: string;
  let queue: ReturnType<typeof fakeQueue>;
  let svc: ActionsService;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db);
    senderId = await seedSender(db, mailboxId);
    queue = fakeQueue();
    svc = new ActionsService(db as never, queue as never);
  });

  it('sender selector: resolves count, persists queued row, enqueues', async () => {
    await seedMessage(db, mailboxId, 'm1', ['INBOX']);
    await seedMessage(db, mailboxId, 'm2', ['INBOX']);
    await seedMessage(db, mailboxId, 'm3', ['CATEGORY_PROMOTIONS']);

    const res = await svc.enqueueArchive({
      mailboxAccountId: mailboxId,
      selector: { type: 'sender', senderId },
      idempotencyKey: 'click-0001',
      override: false,
    });

    expect(res.requestedCount).toBe(2); // inbox-only
    expect(res.status).toBe('queued');
    expect(queue.count).toBe(1);
    expect(queue.jobIds).toEqual(['archive:click-0001']); // verb-namespaced key

    const [row] = await db.select().from(actionJobs).where(eq(actionJobs.id, res.actionId));
    expect(row!.selector).toEqual({ type: 'sender', senderId, senderKey: SENDER_KEY });
    expect(row!.resolvedMessageIds).toEqual([]); // worker resolves at execute
    expect(row!.status).toBe('queued');
  });

  it('blocks a Protected sender unless override is set', async () => {
    await db
      .insert(senderPolicies)
      .values({ mailboxAccountId: mailboxId, senderKey: SENDER_KEY, isProtected: true });
    await seedMessage(db, mailboxId, 'm1', ['INBOX']);

    await expect(
      svc.enqueueArchive({
        mailboxAccountId: mailboxId,
        selector: { type: 'sender', senderId },
        idempotencyKey: 'click-prot',
        override: false,
      }),
    ).rejects.toMatchObject({ response: { code: 'PROTECTED_SENDER' } });

    // With override it proceeds.
    const res = await svc.enqueueArchive({
      mailboxAccountId: mailboxId,
      selector: { type: 'sender', senderId },
      idempotencyKey: 'click-prot-ovr',
      override: true,
    });
    expect(res.status).toBe('queued');
  });

  it('messages selector drops forged ids AND owned-but-not-in-INBOX ids', async () => {
    await seedMessage(db, mailboxId, 'm1', ['INBOX']);
    await seedMessage(db, mailboxId, 'm2', ['INBOX']);
    await seedMessage(db, mailboxId, 'm3', ['CATEGORY_PROMOTIONS']); // owned, NOT in inbox

    const res = await svc.enqueueArchive({
      mailboxAccountId: mailboxId,
      // m3 is owned but archived already; forged-x is not ours. Both drop —
      // the archive verb only touches inbox mail (so undo restores faithfully).
      selector: { type: 'messages', messageIds: ['m1', 'm2', 'm3', 'forged-x'] },
      idempotencyKey: 'click-msgs',
      override: false,
    });
    expect(res.requestedCount).toBe(2);
    const [row] = await db.select().from(actionJobs).where(eq(actionJobs.id, res.actionId));
    expect([...row!.resolvedMessageIds].sort()).toEqual(['m1', 'm2']);
  });

  it('is idempotent on a repeated Idempotency-Key', async () => {
    await seedMessage(db, mailboxId, 'm1', ['INBOX']);
    const first = await svc.enqueueArchive({
      mailboxAccountId: mailboxId,
      selector: { type: 'sender', senderId },
      idempotencyKey: 'same-key',
      override: false,
    });
    const second = await svc.enqueueArchive({
      mailboxAccountId: mailboxId,
      selector: { type: 'sender', senderId },
      idempotencyKey: 'same-key',
      override: false,
    });
    expect(second.actionId).toBe(first.actionId);
    expect(queue.count).toBe(1); // no second enqueue
  });

  it('enqueueRevert creates a reverse row keyed revert:<token>', async () => {
    // The undo controller validates the token exists before calling this,
    // so seed a real journal row (FK target).
    const [undo] = await db
      .insert(undoJournal)
      .values({
        mailboxAccountId: mailboxId,
        actionKind: 'archive',
        payload: { kind: 'archive', messageIds: ['m1', 'm2'], priorLabels: ['INBOX'] },
      })
      .returning({ token: undoJournal.token });
    const token = undo!.token;
    const res = await svc.enqueueRevert({
      mailboxAccountId: mailboxId,
      token,
      verb: 'archive',
      messageIds: ['m1', 'm2'],
    });
    expect(res.status).toBe('queued');
    expect(queue.jobIds).toEqual([`revert:${token}`]);
    const [row] = await db.select().from(actionJobs).where(eq(actionJobs.id, res.actionId));
    expect(row!.direction).toBe('reverse');
    expect(row!.undoToken).toBe(token);
    expect([...row!.resolvedMessageIds].sort()).toEqual(['m1', 'm2']);
  });

  it('getStatus is mailbox-scoped (404 for a foreign mailbox)', async () => {
    await seedMessage(db, mailboxId, 'm1', ['INBOX']);
    const res = await svc.enqueueArchive({
      mailboxAccountId: mailboxId,
      selector: { type: 'sender', senderId },
      idempotencyKey: 'click-status',
      override: false,
    });
    const status = await svc.getStatus(res.actionId, mailboxId);
    expect(status.actionId).toBe(res.actionId);
    await expect(
      svc.getStatus(res.actionId, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ response: { code: 'ACTION_NOT_FOUND' } });
  });

  it('returns 503 when the queue is unavailable', async () => {
    const noQueue = new ActionsService(db as never, null);
    await expect(
      noQueue.enqueueArchive({
        mailboxAccountId: mailboxId,
        selector: { type: 'sender', senderId },
        idempotencyKey: 'click-noredis',
        override: false,
      }),
    ).rejects.toMatchObject({ response: { code: 'QUEUE_UNAVAILABLE' } });
  });
});
