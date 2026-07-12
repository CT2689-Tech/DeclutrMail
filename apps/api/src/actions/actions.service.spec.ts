import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { ConflictException } from '@nestjs/common';
import {
  actionJobs,
  activityLog,
  mailMessages,
  mailboxAccounts,
  outboxEvents,
  schema,
  senderPolicies,
  senders,
  undoJournal,
  users,
  workspaces,
} from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EntitlementsService } from '../common/entitlements/entitlements.service.js';
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

/** Second distinct sender for the D52 multi-sender (bulk) cases. */
const SENDER_KEY_2 = 'c'.repeat(64);

async function seedSecondSender(db: Db, mailboxAccountId: string): Promise<string> {
  const [s] = await db
    .insert(senders)
    .values({
      mailboxAccountId,
      senderKey: SENDER_KEY_2,
      email: 'promo@brand.example',
      domain: 'brand.example',
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
  internalDate: Date = new Date('2026-05-01'),
  senderKey: string = SENDER_KEY,
): Promise<void> {
  await db.insert(mailMessages).values({
    mailboxAccountId,
    providerMessageId: pid,
    providerThreadId: `t-${pid}`,
    senderKey,
    internalDate,
    isUnread: false,
    labelIds: labels,
  });
}

/** Helper: a Date N days before `now`. */
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

/**
 * Fake BullMQ queue — records enqueues AND mirrors two real BullMQ
 * jobId behaviors:
 *   1. a custom id containing `:` is rejected (BullMQ reserves it as
 *      its Redis key separator) — without this the fake would let a
 *      colon jobId through and the bug only surfaces against live Redis;
 *   2. `add` with a jobId that already exists is a no-op (BullMQ
 *      returns the existing job) — the unsub replay path leans on this
 *      dedup, so the fake must model it or count assertions diverge
 *      from the wire. Tests that reset `jobIds` (simulating a lost /
 *      never-enqueued job) reset the dedup state with it.
 */
function fakeQueue() {
  const q = {
    count: 0,
    jobIds: [] as string[],
    add: async (_job: unknown, _data: unknown, opts: { jobId?: string }) => {
      if (opts?.jobId && opts.jobId.includes(':')) {
        throw new Error('Custom Id cannot contain :');
      }
      if (opts?.jobId && q.jobIds.includes(opts.jobId)) return;
      q.count += 1;
      if (opts?.jobId) q.jobIds.push(opts.jobId);
    },
    // Stub for the failed-revert retry path: enqueueRevert calls
    // getJob to drop a stale failed BullMQ hash before re-enqueueing.
    // The fake always returns null (no stale job) so the retry path
    // proceeds straight to `add`. Tests that need to assert the
    // remove() invocation extend this locally.
    getJob: async (_jobId: string) => null,
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
    expect(queue.jobIds).toEqual(['archive-click-0001']); // verb-namespaced, colon-free (BullMQ jobId)

    const [row] = await db.select().from(actionJobs).where(eq(actionJobs.id, res.actionId));
    expect(row!.selector).toEqual({ type: 'sender', senderId, senderKey: SENDER_KEY });
    expect(row!.resolvedMessageIds).toEqual([]); // worker resolves at execute
    expect(row!.status).toBe('queued');
  });

  it('previewArchive returns the REAL inbox-only count (no mutation)', async () => {
    await seedMessage(db, mailboxId, 'm1', ['INBOX']);
    await seedMessage(db, mailboxId, 'm2', ['INBOX']);
    await seedMessage(db, mailboxId, 'm3', ['CATEGORY_PROMOTIONS']); // not in inbox

    const res = await svc.previewArchive({ mailboxAccountId: mailboxId, senderId });

    expect(res).toEqual({ senderId, inboxCount: 2 });
    // Preview never enqueues — it's a read.
    expect(queue.count).toBe(0);
  });

  it('previewArchive returns 0 for a sender with nothing in the inbox', async () => {
    await seedMessage(db, mailboxId, 'm1', ['CATEGORY_PROMOTIONS']);

    const res = await svc.previewArchive({ mailboxAccountId: mailboxId, senderId });
    expect(res.inboxCount).toBe(0);
  });

  it('previewArchive 404s a sender not in the current mailbox', async () => {
    await expect(
      svc.previewArchive({
        mailboxAccountId: mailboxId,
        senderId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toMatchObject({ response: { code: 'SENDER_NOT_FOUND' } });
  });

  it('blocks a Protected sender unless override is set', async () => {
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_KEY,
      isProtected: true,
      protectionReason: 'user_defined',
    });
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
    await db.update(workspaces).set({ tier: 'plus' });
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

  it('legacy messages selector requires Plus before resolving or writing any ids', async () => {
    await seedMessage(db, mailboxId, 'm-free', ['INBOX']);

    await expect(
      svc.enqueueArchive({
        mailboxAccountId: mailboxId,
        selector: { type: 'messages', messageIds: ['m-free'] },
        idempotencyKey: 'free-messages-denied',
        override: false,
      }),
    ).rejects.toMatchObject({
      code: 'ACTION_TIER_REQUIRED',
      details: {
        tier: 'free',
        requiredTier: 'plus',
        selector: 'multi-sender',
        verb: 'archive',
      },
    });
    expect(queue.count).toBe(0);
    expect(await db.select().from(actionJobs)).toHaveLength(0);
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
    expect(queue.jobIds).toEqual([`revert-${token}`]);
    const [row] = await db.select().from(actionJobs).where(eq(actionJobs.id, res.actionId));
    expect(row!.direction).toBe('reverse');
    expect(row!.undoToken).toBe(token);
    expect([...row!.resolvedMessageIds].sort()).toEqual(['m1', 'm2']);
  });

  it('enqueueRevert RETRIES a previously-failed reverse action (MISTAKES 2026-06-05 stale-worker class)', async () => {
    // When a reverse action_jobs row terminated with status='failed' (the
    // smoke session's stale-worker case dead-lettered the original
    // attempt), `undo_journal.reverted_at` stays NULL by design — but the
    // idempotency-key dedup used to return the cached failure forever,
    // leaving the messages permanently stuck in their post-mutation
    // state (Gmail Trash for delete, archive for archive). The retry
    // path resets the row to 'queued' + re-enqueues so the next worker
    // attempt actually runs.
    const [undo] = await db
      .insert(undoJournal)
      .values({
        mailboxAccountId: mailboxId,
        actionKind: 'delete',
        payload: { kind: 'delete', messageIds: ['m-stuck-1', 'm-stuck-2'] },
      })
      .returning({ token: undoJournal.token });
    const token = undo!.token;

    // First attempt — succeeds at enqueue (fake queue records the job).
    const first = await svc.enqueueRevert({
      mailboxAccountId: mailboxId,
      token,
      verb: 'delete',
      messageIds: ['m-stuck-1', 'm-stuck-2'],
    });
    expect(first.status).toBe('queued');

    // Simulate the prior worker run terminally failing (stale-worker
    // class — the row never reaches `done`, errorCode + affected_count
    // record the partial state).
    await db
      .update(actionJobs)
      .set({
        status: 'failed',
        errorCode: 'ValidationError',
        affectedCount: 0,
      })
      .where(eq(actionJobs.id, first.actionId));
    queue.count = 0;
    queue.jobIds = [];

    // Second attempt — MUST retry the same row, not return cached failure.
    const second = await svc.enqueueRevert({
      mailboxAccountId: mailboxId,
      token,
      verb: 'delete',
      messageIds: ['m-stuck-1', 'm-stuck-2'],
    });
    expect(second.actionId).toBe(first.actionId); // same row
    expect(second.status).toBe('queued'); // reset, not 'failed'
    expect(queue.jobIds).toEqual([`revert-${token}`]); // re-enqueued

    // The row's failure metadata is cleared so the next worker run
    // starts fresh.
    const [retried] = await db.select().from(actionJobs).where(eq(actionJobs.id, first.actionId));
    expect(retried!.status).toBe('queued');
    expect(retried!.errorCode).toBeNull();
    expect(retried!.affectedCount).toBe(0);
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

  describe('previewComposite (ADR-0020)', () => {
    it('returns sender context strip + per-bucket counts in one round-trip', async () => {
      // 5 inbox messages spread across the time-window buckets, plus one
      // archived (not in INBOX → excluded from every bucket).
      await seedMessage(db, mailboxId, 'm-2d', ['INBOX'], daysAgo(2));
      await seedMessage(db, mailboxId, 'm-45d', ['INBOX'], daysAgo(45));
      await seedMessage(db, mailboxId, 'm-100d', ['INBOX'], daysAgo(100));
      await seedMessage(db, mailboxId, 'm-200d', ['INBOX'], daysAgo(200));
      await seedMessage(db, mailboxId, 'm-400d', ['INBOX'], daysAgo(400));
      await seedMessage(db, mailboxId, 'm-archived', ['CATEGORY_PROMOTIONS'], daysAgo(10));

      const res = await svc.previewComposite({ mailboxAccountId: mailboxId, senderId });

      // Bucket math (older-than X means `internal_date <= now - X days`):
      //   all      = 5 inbox messages
      //   >30d     = 45 + 100 + 200 + 400         = 4
      //   >90d     = 100 + 200 + 400              = 3
      //   >180d    = 200 + 400                    = 2
      //   >365d    = 400                          = 1
      //   monthly  = ALL inbound messages WITHIN last 30 days regardless
      //              of labels = m-2d + m-archived → 2. The strip's
      //              "N /mo" mirrors the senders-list card (last30dMsgs),
      //              NOT the inbox-scoped buckets — an archived-recent
      //              sender must not read "0 /mo" (live bug 2026-07-03).
      expect(res.counts).toEqual({
        all: 5,
        olderThan30d: 4,
        olderThan90d: 3,
        olderThan180d: 2,
        olderThan365d: 1,
      });
      expect(res.sender.monthly).toBe(2);
      expect(res.sender.domain).toBe('shop.example');
      expect(res.unsubAvailable).toBe(false);
      expect(res.protected).toBe(false);
      // Spec v1.3 — recent subjects per window. Each array is top-5 most-
      // recent (DESC by internal_date). The fixture's INBOX messages have
      // `subject` = '' (seed default), so we assert COUNTS not contents.
      // The exclusion of `m-archived` is what matters semantically: it
      // never appears in any recent-subjects bucket because its label
      // mask lacks INBOX.
      expect(res.recentSubjects.all).toHaveLength(5);
      expect(res.recentSubjects.olderThan30d).toHaveLength(4);
      expect(res.recentSubjects.olderThan90d).toHaveLength(3);
      expect(res.recentSubjects.olderThan180d).toHaveLength(2);
      expect(res.recentSubjects.olderThan365d).toHaveLength(1);
    });

    it('returns protected:true when the sender has a policy row', async () => {
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY,
        isProtected: true,
        protectionReason: 'user_defined',
      });
      const res = await svc.previewComposite({ mailboxAccountId: mailboxId, senderId });
      expect(res.protected).toBe(true);
    });

    it('404s a sender not in the current mailbox', async () => {
      await expect(
        svc.previewComposite({
          mailboxAccountId: mailboxId,
          senderId: '00000000-0000-4000-8000-000000000000',
        }),
      ).rejects.toMatchObject({ response: { code: 'SENDER_NOT_FOUND' } });
    });
  });

  describe('enqueueComposite (ADR-0020)', () => {
    it('messages selector requires Plus before a primary or secondary can write', async () => {
      await seedMessage(db, mailboxId, 'm-free-composite', ['INBOX']);

      await expect(
        svc.enqueueComposite({
          mailboxAccountId: mailboxId,
          selector: { type: 'messages', messageIds: ['m-free-composite'] },
          primary: { type: 'later' },
          secondary: { type: 'delete' },
          idempotencyKey: 'free-composite-messages-denied',
          override: false,
        }),
      ).rejects.toMatchObject({
        code: 'ACTION_TIER_REQUIRED',
        details: { selector: 'multi-sender', verb: 'later' },
      });
      expect(queue.count).toBe(0);
      expect(await db.select().from(actionJobs)).toHaveLength(0);
    });

    it('Plus messages selector preserves owned-id filtering for primary + secondary', async () => {
      await db.update(workspaces).set({ tier: 'plus' });
      await seedMessage(db, mailboxId, 'm-owned', ['INBOX']);
      await seedMessage(db, mailboxId, 'm-not-inbox', ['CATEGORY_PROMOTIONS']);

      const assertActionSelectorTier = vi.fn().mockResolvedValue(undefined);
      const checkedSvc = new ActionsService(db as never, queue as never, undefined, null, {
        assertActionSelectorTier,
        assertCleanupCapacity: vi.fn().mockResolvedValue(undefined),
      } as never);

      const res = await checkedSvc.enqueueComposite({
        mailboxAccountId: mailboxId,
        selector: {
          type: 'messages',
          messageIds: ['m-owned', 'm-not-inbox', 'm-forged'],
        },
        primary: { type: 'later' },
        secondary: { type: 'delete' },
        idempotencyKey: 'plus-composite-messages',
        override: false,
      });

      expect(res.primaryCount).toBe(1);
      expect(res.secondaryCount).toBe(1);
      const rows = await db
        .select()
        .from(actionJobs)
        .where(eq(actionJobs.mailboxAccountId, mailboxId));
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.selector.type === 'messages')).toBe(true);
      expect(rows.every((row) => row.resolvedMessageIds.join(',') === 'm-owned')).toBe(true);
      expect(assertActionSelectorTier).toHaveBeenNthCalledWith(
        1,
        mailboxId,
        'later',
        'multi-sender',
      );
      expect(assertActionSelectorTier).toHaveBeenNthCalledWith(
        2,
        mailboxId,
        'delete',
        'multi-sender',
      );
    });

    it('single-verb Archive: ONE row, composite_id null, namespaced idempotency key', async () => {
      await seedMessage(db, mailboxId, 'm1', ['INBOX'], daysAgo(5));
      const res = await svc.enqueueComposite({
        mailboxAccountId: mailboxId,
        selector: { type: 'sender', senderId },
        primary: { type: 'archive' },
        idempotencyKey: 'click-arch-only',
        override: false,
      });
      expect(res.actionId).toBeTruthy();
      expect(res.compositeId).toBe(res.actionId); // wire convention: mirror id
      expect(res.secondaryId).toBeNull();
      expect(res.primaryCount).toBe(1);
      expect(res.secondaryCount).toBeNull();
      expect(queue.jobIds).toEqual(['archive-click-arch-only']);
      const rows = await db
        .select()
        .from(actionJobs)
        .where(eq(actionJobs.mailboxAccountId, mailboxId));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.verb).toBe('archive');
      expect(rows[0]!.compositeId).toBeNull(); // DB-level: primary is self-implicit
    });

    it('time-window narrows the persisted requestedCount + olderThanDays', async () => {
      await seedMessage(db, mailboxId, 'm-recent', ['INBOX'], daysAgo(10));
      await seedMessage(db, mailboxId, 'm-old', ['INBOX'], daysAgo(200));
      const res = await svc.enqueueComposite({
        mailboxAccountId: mailboxId,
        selector: { type: 'sender', senderId },
        primary: { type: 'delete', olderThanDays: 180 },
        idempotencyKey: 'click-del-180',
        override: false,
      });
      expect(res.primaryCount).toBe(1); // only m-old satisfies 180+ days
      const [row] = await db.select().from(actionJobs).where(eq(actionJobs.id, res.actionId));
      expect(row!.olderThanDays).toBe(180);
      expect(row!.requestedCount).toBe(1);
      expect(row!.verb).toBe('delete');
    });

    it('composite Later + Delete past: TWO rows linked by composite_id, both enqueued', async () => {
      await seedMessage(db, mailboxId, 'm-recent', ['INBOX'], daysAgo(10));
      await seedMessage(db, mailboxId, 'm-old', ['INBOX'], daysAgo(400));
      const res = await svc.enqueueComposite({
        mailboxAccountId: mailboxId,
        selector: { type: 'sender', senderId },
        primary: { type: 'later' },
        secondary: { type: 'delete', olderThanDays: 365 },
        idempotencyKey: 'click-later-del',
        override: false,
      });
      expect(res.secondaryId).toBeTruthy();
      expect(res.primaryCount).toBe(2); // primary's window = null → both inbox messages
      expect(res.secondaryCount).toBe(1); // secondary's window = 365+ → just m-old
      // BOTH jobs are enqueued, with distinct namespaced keys.
      expect(queue.jobIds.sort()).toEqual(['delete-click-later-del-sec', 'later-click-later-del']);
      const rows = await db
        .select()
        .from(actionJobs)
        .where(eq(actionJobs.mailboxAccountId, mailboxId));
      expect(rows).toHaveLength(2);
      const primary = rows.find((r) => r.id === res.actionId);
      const secondary = rows.find((r) => r.id === res.secondaryId);
      expect(primary!.verb).toBe('later');
      expect(primary!.compositeId).toBeNull(); // primary is self-implicit
      expect(secondary!.verb).toBe('delete');
      expect(secondary!.compositeId).toBe(primary!.id); // secondary points up
    });

    it('Protected sender blocks BOTH rows before either is written (no partial-composite)', async () => {
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY,
        isProtected: true,
        protectionReason: 'user_defined',
      });
      await seedMessage(db, mailboxId, 'm1', ['INBOX']);
      await expect(
        svc.enqueueComposite({
          mailboxAccountId: mailboxId,
          selector: { type: 'sender', senderId },
          primary: { type: 'later' },
          secondary: { type: 'delete', olderThanDays: 90 },
          idempotencyKey: 'click-prot-comp',
          override: false,
        }),
      ).rejects.toMatchObject({ response: { code: 'PROTECTED_SENDER' } });
      const rows = await db
        .select()
        .from(actionJobs)
        .where(eq(actionJobs.mailboxAccountId, mailboxId));
      expect(rows).toHaveLength(0);
    });
  });

  describe('enqueueCompositeRevert (ADR-0020 cascade-undo)', () => {
    it('single-verb action: returns just the one reverse row', async () => {
      const [u] = await db
        .insert(undoJournal)
        .values({
          mailboxAccountId: mailboxId,
          actionKind: 'archive',
          payload: { kind: 'archive', messageIds: ['m1'], priorLabels: ['INBOX'] },
        })
        .returning({ token: undoJournal.token });
      const [fwd] = await db
        .insert(actionJobs)
        .values({
          mailboxAccountId: mailboxId,
          verb: 'archive',
          direction: 'forward',
          status: 'done',
          selector: { type: 'sender', senderId, senderKey: SENDER_KEY },
          resolvedMessageIds: ['m1'],
          idempotencyKey: 'archive-orig-1',
          undoToken: u!.token,
        })
        .returning({ id: actionJobs.id });
      const res = await svc.enqueueCompositeRevert({
        mailboxAccountId: mailboxId,
        token: u!.token,
      });
      expect(res).toHaveLength(1);
      expect(res[0]!.token).toBe(u!.token);
      // Cascade resolved no extras — confirm by checking only the one
      // reverse row was inserted.
      const reverses = await db
        .select()
        .from(actionJobs)
        .where(eq(actionJobs.direction, 'reverse'));
      expect(reverses).toHaveLength(1);
      expect(reverses[0]!.undoToken).toBe(u!.token);
      // Forward row is preserved alongside its reverse.
      expect(fwd).toBeTruthy();
    });

    it('composite: reverses BOTH siblings in primary-first order', async () => {
      // Two undo tokens (primary later, secondary delete) — both forward
      // rows have undo tokens (they each affected ≥1 message).
      const [uP] = await db
        .insert(undoJournal)
        .values({
          mailboxAccountId: mailboxId,
          actionKind: 'later',
          payload: { kind: 'later', messageIds: ['m1', 'm2'], priorLabels: ['INBOX'] },
        })
        .returning({ token: undoJournal.token });
      const [uS] = await db
        .insert(undoJournal)
        .values({
          mailboxAccountId: mailboxId,
          actionKind: 'delete',
          payload: { kind: 'delete', messageIds: ['m2'] },
        })
        .returning({ token: undoJournal.token });
      const [primary] = await db
        .insert(actionJobs)
        .values({
          mailboxAccountId: mailboxId,
          verb: 'later',
          direction: 'forward',
          status: 'done',
          selector: { type: 'sender', senderId, senderKey: SENDER_KEY },
          resolvedMessageIds: ['m1', 'm2'],
          idempotencyKey: 'later-comp-1',
          undoToken: uP!.token,
        })
        .returning({ id: actionJobs.id });
      await db.insert(actionJobs).values({
        mailboxAccountId: mailboxId,
        verb: 'delete',
        direction: 'forward',
        status: 'done',
        selector: { type: 'sender', senderId, senderKey: SENDER_KEY },
        resolvedMessageIds: ['m2'],
        idempotencyKey: 'delete-comp-1-sec',
        undoToken: uS!.token,
        compositeId: primary!.id,
      });

      // Undo via EITHER token cascades to both.
      const res = await svc.enqueueCompositeRevert({
        mailboxAccountId: mailboxId,
        token: uS!.token, // the secondary's token
      });
      expect(res).toHaveLength(2);
      // Primary-first ordering (the FE polls the first as the user-visible
      // progress signal).
      expect(res[0]!.token).toBe(uP!.token);
      expect(res[1]!.token).toBe(uS!.token);
      // Two reverse rows inserted, namespaced by `revert-<token>`.
      expect(queue.jobIds.sort()).toEqual([`revert-${uP!.token}`, `revert-${uS!.token}`].sort());
    });

    it('skips siblings with no undo token (the empty-resolve case)', async () => {
      const [uP] = await db
        .insert(undoJournal)
        .values({
          mailboxAccountId: mailboxId,
          actionKind: 'archive',
          payload: { kind: 'archive', messageIds: ['m1'], priorLabels: ['INBOX'] },
        })
        .returning({ token: undoJournal.token });
      const [primary] = await db
        .insert(actionJobs)
        .values({
          mailboxAccountId: mailboxId,
          verb: 'archive',
          direction: 'forward',
          status: 'done',
          selector: { type: 'sender', senderId, senderKey: SENDER_KEY },
          resolvedMessageIds: ['m1'],
          idempotencyKey: 'arch-skip-1',
          undoToken: uP!.token,
        })
        .returning({ id: actionJobs.id });
      // Secondary affected zero messages → completed with undoToken=null.
      await db.insert(actionJobs).values({
        mailboxAccountId: mailboxId,
        verb: 'delete',
        direction: 'forward',
        status: 'done',
        affectedCount: 0,
        selector: { type: 'sender', senderId, senderKey: SENDER_KEY },
        resolvedMessageIds: [],
        idempotencyKey: 'del-skip-1-sec',
        compositeId: primary!.id,
      });

      const res = await svc.enqueueCompositeRevert({
        mailboxAccountId: mailboxId,
        token: uP!.token,
      });
      // Only the primary is revertable; the no-op secondary is silently
      // skipped (no reverse row, no enqueue).
      expect(res).toHaveLength(1);
      expect(queue.jobIds).toEqual([`revert-${uP!.token}`]);
    });

    it('404s a token that has no forward action row', async () => {
      await expect(
        svc.enqueueCompositeRevert({
          mailboxAccountId: mailboxId,
          token: '00000000-0000-4000-8000-000000000000',
        }),
      ).rejects.toMatchObject({ response: { code: 'ACTION_NOT_FOUND' } });
    });
  });

  describe('previewBulkComposite (D52 aggregated preview)', () => {
    beforeEach(async () => {
      await db.update(workspaces).set({ tier: 'plus' });
    });

    it('rejects a Free workspace before resolving any multi-sender preview data', async () => {
      await db.update(workspaces).set({ tier: 'free' });
      const sender2Id = await seedSecondSender(db, mailboxId);

      await expect(
        svc.previewBulkComposite({
          mailboxAccountId: mailboxId,
          senderIds: [senderId, sender2Id],
        }),
      ).rejects.toMatchObject({
        code: 'ACTION_TIER_REQUIRED',
        details: { tier: 'free', requiredTier: 'plus', selector: 'multi-sender' },
      });
    });

    it('aggregates bucket counts across the selection with a per-sender breakdown', async () => {
      const sender2Id = await seedSecondSender(db, mailboxId);
      // Sender 1: two INBOX messages (5d + 100d) and one archived (excluded).
      await seedMessage(db, mailboxId, 's1-recent', ['INBOX'], daysAgo(5));
      await seedMessage(db, mailboxId, 's1-old', ['INBOX'], daysAgo(100));
      await seedMessage(db, mailboxId, 's1-archived', ['CATEGORY_PROMOTIONS'], daysAgo(10));
      // Sender 2: one ancient INBOX message.
      await seedMessage(db, mailboxId, 's2-ancient', ['INBOX'], daysAgo(400), SENDER_KEY_2);

      const res = await svc.previewBulkComposite({
        mailboxAccountId: mailboxId,
        senderIds: [senderId, sender2Id],
      });

      expect(res.totals).toEqual({
        all: 3,
        olderThan30d: 2, // 100d + 400d
        olderThan90d: 2,
        olderThan180d: 1, // 400d only
        olderThan365d: 1,
      });
      // Per-sender breakdown follows the request order.
      expect(res.senders.map((s) => s.senderId)).toEqual([senderId, sender2Id]);
      expect(res.senders[0]!.counts.all).toBe(2);
      expect(res.senders[1]!.counts.all).toBe(1);
      expect(res.protectedCount).toBe(0);
      // Preview never enqueues — it's a read.
      expect(queue.count).toBe(0);
    });

    it('excludes Protected/VIP senders from totals but keeps them flagged in the breakdown', async () => {
      const sender2Id = await seedSecondSender(db, mailboxId);
      await seedMessage(db, mailboxId, 's1-m', ['INBOX'], daysAgo(5));
      await seedMessage(db, mailboxId, 's2-m', ['INBOX'], daysAgo(5), SENDER_KEY_2);
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY_2,
        isProtected: true,
        protectionReason: 'user_defined',
      });

      const res = await svc.previewBulkComposite({
        mailboxAccountId: mailboxId,
        senderIds: [senderId, sender2Id],
      });
      // The enqueue will SKIP the protected sender, so the aggregate must
      // exclude it — preview ≡ what will actually move.
      expect(res.totals.all).toBe(1);
      expect(res.protectedCount).toBe(1);
      const protectedRow = res.senders.find((s) => s.senderId === sender2Id);
      expect(protectedRow!.protected).toBe(true);
      expect(protectedRow!.counts.all).toBe(1); // shown, just not totalled
    });

    it('drops forged / cross-mailbox sender ids silently', async () => {
      await seedMessage(db, mailboxId, 's1-m', ['INBOX'], daysAgo(5));
      const res = await svc.previewBulkComposite({
        mailboxAccountId: mailboxId,
        senderIds: [senderId, '00000000-0000-4000-8000-000000000000'],
      });
      expect(res.senders).toHaveLength(1);
      expect(res.senders[0]!.senderId).toBe(senderId);
    });
  });

  describe('enqueueBulkComposite (D52 multi-sender fan-out)', () => {
    beforeEach(async () => {
      await db.update(workspaces).set({ tier: 'plus' });
    });

    it('rejects a Free multi-sender enqueue before writing or queueing, while single-sender stays available', async () => {
      await db.update(workspaces).set({ tier: 'free' });
      const sender2Id = await seedSecondSender(db, mailboxId);

      await expect(
        svc.enqueueBulkComposite({
          mailboxAccountId: mailboxId,
          senderIds: [senderId, sender2Id],
          primary: { type: 'archive' },
          idempotencyKey: 'bulk-free-denied',
        }),
      ).rejects.toMatchObject({
        code: 'ACTION_TIER_REQUIRED',
        details: { tier: 'free', requiredTier: 'plus', selector: 'multi-sender' },
      });
      expect(queue.count).toBe(0);
      expect(await db.select().from(actionJobs)).toHaveLength(0);

      await expect(
        svc.enqueueComposite({
          mailboxAccountId: mailboxId,
          selector: { type: 'sender', senderId },
          primary: { type: 'archive' },
          idempotencyKey: 'single-free-allowed',
          override: false,
        }),
      ).resolves.toMatchObject({ status: 'queued' });
    });

    it('fans out one row per sender linked to the anchor, with per-sender counts + keys', async () => {
      const sender2Id = await seedSecondSender(db, mailboxId);
      await seedMessage(db, mailboxId, 's1-a', ['INBOX'], daysAgo(5));
      await seedMessage(db, mailboxId, 's1-b', ['INBOX'], daysAgo(10));
      await seedMessage(db, mailboxId, 's2-a', ['INBOX'], daysAgo(5), SENDER_KEY_2);

      const res = await svc.enqueueBulkComposite({
        mailboxAccountId: mailboxId,
        senderIds: [senderId, sender2Id],
        primary: { type: 'archive' },
        idempotencyKey: 'bulk-click-1',
      });

      expect(res.senderCount).toBe(2);
      expect(res.requestedTotal).toBe(3);
      expect(res.skipped).toEqual([]);
      expect(res.status).toBe('queued');
      expect(queue.count).toBe(2);
      // Deterministic per-sender keys — `${verb}-${key}-${senderId}`.
      expect([...queue.jobIds].sort()).toEqual(
        [`archive-bulk-click-1-${senderId}`, `archive-bulk-click-1-${sender2Id}`].sort(),
      );

      const rows = await db
        .select()
        .from(actionJobs)
        .where(eq(actionJobs.mailboxAccountId, mailboxId));
      expect(rows).toHaveLength(2);
      const anchor = rows.find((r) => r.id === res.batchId);
      const other = rows.find((r) => r.id !== res.batchId);
      expect(anchor!.compositeId).toBeNull(); // anchor is self-implicit
      expect(other!.compositeId).toBe(anchor!.id); // sibling points at the anchor
      // Per-sender requestedCount, not a shared total.
      const bySelector = new Map(
        rows.map((r) => [(r.selector as { senderId: string }).senderId, r] as const),
      );
      expect(bySelector.get(senderId)!.requestedCount).toBe(2);
      expect(bySelector.get(sender2Id)!.requestedCount).toBe(1);
    });

    it('is idempotent on a repeated Idempotency-Key (same batch, no double enqueue)', async () => {
      const sender2Id = await seedSecondSender(db, mailboxId);
      await seedMessage(db, mailboxId, 's1-a', ['INBOX'], daysAgo(5));
      const first = await svc.enqueueBulkComposite({
        mailboxAccountId: mailboxId,
        senderIds: [senderId, sender2Id],
        primary: { type: 'archive' },
        idempotencyKey: 'bulk-same-key',
      });
      const second = await svc.enqueueBulkComposite({
        mailboxAccountId: mailboxId,
        senderIds: [sender2Id, senderId], // order shuffled — same selection
        primary: { type: 'archive' },
        idempotencyKey: 'bulk-same-key',
      });
      expect(second.batchId).toBe(first.batchId);
      expect(queue.count).toBe(2); // no re-enqueue on replay
      const rows = await db
        .select()
        .from(actionJobs)
        .where(eq(actionJobs.mailboxAccountId, mailboxId));
      expect(rows).toHaveLength(2);
    });

    it('skips a Protected sender without poisoning the rest of the batch', async () => {
      const sender2Id = await seedSecondSender(db, mailboxId);
      await seedMessage(db, mailboxId, 's1-a', ['INBOX'], daysAgo(5));
      await seedMessage(db, mailboxId, 's2-a', ['INBOX'], daysAgo(5), SENDER_KEY_2);
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY_2,
        isProtected: true,
        protectionReason: 'user_defined',
      });

      const res = await svc.enqueueBulkComposite({
        mailboxAccountId: mailboxId,
        senderIds: [senderId, sender2Id],
        primary: { type: 'delete', olderThanDays: null },
        idempotencyKey: 'bulk-prot-1',
      });
      expect(res.senderCount).toBe(1);
      expect(res.skipped).toEqual([{ senderId: sender2Id, reason: 'protected' }]);
      const rows = await db
        .select()
        .from(actionJobs)
        .where(eq(actionJobs.mailboxAccountId, mailboxId));
      expect(rows).toHaveLength(1); // ONLY the unprotected sender got a row
      expect((rows[0]!.selector as { senderId: string }).senderId).toBe(senderId);
    });

    it('reports unknown ids as not_found and 409s when nothing is actionable', async () => {
      const forged = '00000000-0000-4000-8000-000000000000';
      // Mixed: one real, one forged → batch proceeds, forged reported.
      const partial = await svc.enqueueBulkComposite({
        mailboxAccountId: mailboxId,
        senderIds: [senderId, forged],
        primary: { type: 'archive' },
        idempotencyKey: 'bulk-mixed-1',
      });
      expect(partial.skipped).toEqual([{ senderId: forged, reason: 'not_found' }]);
      expect(partial.senderCount).toBe(1);

      // All-skipped → 409, no rows written.
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY,
        isProtected: true,
        protectionReason: 'user_defined',
      });
      await expect(
        svc.enqueueBulkComposite({
          mailboxAccountId: mailboxId,
          senderIds: [senderId, forged],
          primary: { type: 'archive' },
          idempotencyKey: 'bulk-none-1',
        }),
      ).rejects.toMatchObject({ response: { code: 'NO_ACTIONABLE_SENDERS' } });
    });

    it('fans a secondary out per sender, linked to the SAME batch anchor', async () => {
      const sender2Id = await seedSecondSender(db, mailboxId);
      await seedMessage(db, mailboxId, 's1-recent', ['INBOX'], daysAgo(5));
      await seedMessage(db, mailboxId, 's1-old', ['INBOX'], daysAgo(400));
      await seedMessage(db, mailboxId, 's2-old', ['INBOX'], daysAgo(400), SENDER_KEY_2);

      const res = await svc.enqueueBulkComposite({
        mailboxAccountId: mailboxId,
        senderIds: [senderId, sender2Id],
        primary: { type: 'later' },
        secondary: { type: 'delete', olderThanDays: 365 },
        idempotencyKey: 'bulk-comp-1',
      });

      const rows = await db
        .select()
        .from(actionJobs)
        .where(eq(actionJobs.mailboxAccountId, mailboxId));
      expect(rows).toHaveLength(4); // 2 primaries + 2 secondaries
      // Flat one-level linkage: every non-anchor row points at the anchor,
      // so ONE undo token cascades the whole batch (ADR-0020).
      const anchor = rows.find((r) => r.id === res.batchId)!;
      expect(anchor.compositeId).toBeNull();
      for (const row of rows.filter((r) => r.id !== anchor.id)) {
        expect(row.compositeId).toBe(anchor.id);
      }
      const secondaries = rows.filter((r) => r.verb === 'delete');
      expect(secondaries).toHaveLength(2);
      // Secondary windows narrow per sender: s1 has one 365d+ message, s2 has one.
      for (const sec of secondaries) {
        expect(sec.olderThanDays).toBe(365);
        expect(sec.requestedCount).toBe(1);
      }
      expect(queue.count).toBe(4);
    });

    it('returns 503 when the queue is unavailable', async () => {
      const sender2Id = await seedSecondSender(db, mailboxId);
      const noQueue = new ActionsService(db as never, null);
      await expect(
        noQueue.enqueueBulkComposite({
          mailboxAccountId: mailboxId,
          senderIds: [senderId, sender2Id],
          primary: { type: 'archive' },
          idempotencyKey: 'bulk-noredis',
        }),
      ).rejects.toMatchObject({ response: { code: 'QUEUE_UNAVAILABLE' } });
    });
  });

  describe('getBatchStatus (D52 aggregate poll)', () => {
    beforeEach(async () => {
      // Batch handles can only be produced by the Plus multi-sender
      // selector. Seed the real entitlement instead of weakening the
      // production gate in these status-only fixtures.
      await db.update(workspaces).set({ tier: 'plus' });
    });

    /** Build a 2-sender archive batch and return its handle + row ids. */
    async function seedBatch(): Promise<{
      batchId: string;
      anchorId: string;
      otherId: string;
    }> {
      const sender2Id = await seedSecondSender(db, mailboxId);
      await seedMessage(db, mailboxId, 's1-a', ['INBOX'], daysAgo(5));
      await seedMessage(db, mailboxId, 's2-a', ['INBOX'], daysAgo(5), SENDER_KEY_2);
      const res = await svc.enqueueBulkComposite({
        mailboxAccountId: mailboxId,
        senderIds: [senderId, sender2Id],
        primary: { type: 'archive' },
        idempotencyKey: 'bulk-batch-1',
      });
      const rows = await db
        .select()
        .from(actionJobs)
        .where(eq(actionJobs.mailboxAccountId, mailboxId));
      const other = rows.find((r) => r.id !== res.batchId)!;
      return { batchId: res.batchId, anchorId: res.batchId, otherId: other.id };
    }

    it('walks queued → executing → done as siblings progress', async () => {
      const { batchId, anchorId, otherId } = await seedBatch();

      let status = await svc.getBatchStatus(batchId, mailboxId);
      expect(status).toMatchObject({ batchId, status: 'queued', total: 2, done: 0, failed: 0 });

      await db.update(actionJobs).set({ status: 'executing' }).where(eq(actionJobs.id, anchorId));
      status = await svc.getBatchStatus(batchId, mailboxId);
      expect(status.status).toBe('executing');

      // Anchor completes with an undo token; sibling completes after.
      const [u] = await db
        .insert(undoJournal)
        .values({
          mailboxAccountId: mailboxId,
          actionKind: 'archive',
          payload: { kind: 'archive', messageIds: ['s1-a'], priorLabels: ['INBOX'] },
        })
        .returning({ token: undoJournal.token });
      await db
        .update(actionJobs)
        .set({ status: 'done', affectedCount: 1, undoToken: u!.token })
        .where(eq(actionJobs.id, anchorId));
      await db
        .update(actionJobs)
        .set({ status: 'done', affectedCount: 1 })
        .where(eq(actionJobs.id, otherId));

      status = await svc.getBatchStatus(batchId, mailboxId);
      expect(status).toMatchObject({
        status: 'done',
        total: 2,
        done: 2,
        failed: 0,
        affectedCount: 2,
        undoToken: u!.token,
      });
    });

    it('reports a partial failure as done + failed count (isolation, never poisoned)', async () => {
      const { batchId, anchorId, otherId } = await seedBatch();
      const [u] = await db
        .insert(undoJournal)
        .values({
          mailboxAccountId: mailboxId,
          actionKind: 'archive',
          payload: { kind: 'archive', messageIds: ['s1-a'], priorLabels: ['INBOX'] },
        })
        .returning({ token: undoJournal.token });
      await db
        .update(actionJobs)
        .set({ status: 'done', affectedCount: 1, undoToken: u!.token })
        .where(eq(actionJobs.id, anchorId));
      await db
        .update(actionJobs)
        .set({ status: 'failed', errorCode: 'GmailError' })
        .where(eq(actionJobs.id, otherId));

      const status = await svc.getBatchStatus(batchId, mailboxId);
      expect(status).toMatchObject({
        status: 'done', // terminal; partial failure surfaces via `failed`
        done: 1,
        failed: 1,
        affectedCount: 1,
        undoToken: u!.token, // the succeeded sender remains undoable
      });
    });

    it('reports all-failed as failed', async () => {
      const { batchId } = await seedBatch();
      await db
        .update(actionJobs)
        .set({ status: 'failed', errorCode: 'GmailError' })
        .where(eq(actionJobs.mailboxAccountId, mailboxId));
      const status = await svc.getBatchStatus(batchId, mailboxId);
      expect(status.status).toBe('failed');
      expect(status.undoToken).toBeNull();
    });

    it('is mailbox-scoped (404 for a foreign mailbox)', async () => {
      const { batchId } = await seedBatch();
      await expect(
        svc.getBatchStatus(batchId, '00000000-0000-0000-0000-000000000000'),
      ).rejects.toMatchObject({ response: { code: 'ACTION_NOT_FOUND' } });
    });

    it('batch undo cascades across senders via the batch token (ADR-0020)', async () => {
      const { batchId, anchorId, otherId } = await seedBatch();
      // Both siblings complete with their own undo tokens.
      const [u1] = await db
        .insert(undoJournal)
        .values({
          mailboxAccountId: mailboxId,
          actionKind: 'archive',
          payload: { kind: 'archive', messageIds: ['s1-a'], priorLabels: ['INBOX'] },
        })
        .returning({ token: undoJournal.token });
      const [u2] = await db
        .insert(undoJournal)
        .values({
          mailboxAccountId: mailboxId,
          actionKind: 'archive',
          payload: { kind: 'archive', messageIds: ['s2-a'], priorLabels: ['INBOX'] },
        })
        .returning({ token: undoJournal.token });
      await db
        .update(actionJobs)
        .set({ status: 'done', affectedCount: 1, undoToken: u1!.token })
        .where(eq(actionJobs.id, anchorId));
      await db
        .update(actionJobs)
        .set({ status: 'done', affectedCount: 1, undoToken: u2!.token })
        .where(eq(actionJobs.id, otherId));
      queue.count = 0;
      queue.jobIds = [];

      // The FE undoes with the batch token (= anchor's). The cascade must
      // reach EVERY sender's forward row, not just the anchor's.
      const status = await svc.getBatchStatus(batchId, mailboxId);
      const reverts = await svc.enqueueCompositeRevert({
        mailboxAccountId: mailboxId,
        token: status.undoToken!,
      });
      expect(reverts).toHaveLength(2);
      expect([...queue.jobIds].sort()).toEqual(
        [`revert-${u1!.token}`, `revert-${u2!.token}`].sort(),
      );
    });
  });

  describe('recordUnsubscribeIntent (D38 + 2026-06-05 brainstorm)', () => {
    beforeEach(async () => {
      await db
        .update(senders)
        .set({
          unsubscribeMethod: 'mailto',
          unsubscribeUrl: 'mailto:unsubscribe@shop.example?subject=unsubscribe',
        })
        .where(eq(senders.id, senderId));
    });

    it('upserts sender_policies + writes 0-affected activity_log row + returns the id', async () => {
      const result = await svc.recordUnsubscribeIntent({
        mailboxAccountId: mailboxId,
        senderId,
        idempotencyKey: 'unsub-key-1',
      });
      expect(result.senderId).toBe(senderId);
      expect(result.activityLogId).toMatch(/^[0-9a-f-]{36}$/);
      // sender_policies upsert: policy_type='unsubscribe'.
      const policies = await db
        .select()
        .from(senderPolicies)
        .where(eq(senderPolicies.mailboxAccountId, mailboxId));
      expect(policies).toHaveLength(1);
      expect(policies[0]!.policyType).toBe('unsubscribe');
      // activity_log: 0-affected unsubscribe row, source='manual', no undo token.
      const acts = await db
        .select()
        .from(activityLog)
        .where(eq(activityLog.mailboxAccountId, mailboxId));
      expect(acts).toHaveLength(1);
      expect(acts[0]!.action).toBe('unsubscribe');
      expect(acts[0]!.source).toBe('manual');
      expect(acts[0]!.affectedCount).toBe(0);
      expect(acts[0]!.undoToken).toBeNull();
    });

    it('is idempotent at the policy level — second call upserts to the same row but writes a SECOND audit row', async () => {
      await svc.recordUnsubscribeIntent({
        mailboxAccountId: mailboxId,
        senderId,
        idempotencyKey: 'unsub-key-a',
      });
      await svc.recordUnsubscribeIntent({
        mailboxAccountId: mailboxId,
        senderId,
        idempotencyKey: 'unsub-key-b',
      });
      const policies = await db
        .select()
        .from(senderPolicies)
        .where(eq(senderPolicies.mailboxAccountId, mailboxId));
      // Single policy row — upsert dedups.
      expect(policies).toHaveLength(1);
      expect(policies[0]!.policyType).toBe('unsubscribe');
      // Two activity_log rows — each click is a recorded decision.
      const acts = await db
        .select()
        .from(activityLog)
        .where(eq(activityLog.mailboxAccountId, mailboxId));
      expect(acts).toHaveLength(2);
      expect(acts.every((a) => a.action === 'unsubscribe')).toBe(true);
    });

    it('DB-level idempotency dedup — same key twice → ONE activity_log row + ONE cached action_jobs row (mig 0024)', async () => {
      // FOUNDER-FOLLOWUPS 2026-06-05: a network-retried POST with the
      // SAME Idempotency-Key MUST collapse to one audit row, returning
      // the cached activity_log_id on the second call. Migration 0024
      // adds 'unsubscribe' to action_verb so action_jobs.idempotency_key
      // becomes the DB-level dedup partner.
      const first = await svc.recordUnsubscribeIntent({
        mailboxAccountId: mailboxId,
        senderId,
        idempotencyKey: 'shared-replay-key',
      });
      const second = await svc.recordUnsubscribeIntent({
        mailboxAccountId: mailboxId,
        senderId,
        idempotencyKey: 'shared-replay-key',
      });
      expect(second.activityLogId).toBe(first.activityLogId);
      expect(second.recordedAt).toBe(first.recordedAt);

      // One audit row (NOT two — that's the dedup we're enforcing).
      const acts = await db
        .select()
        .from(activityLog)
        .where(eq(activityLog.mailboxAccountId, mailboxId));
      expect(acts).toHaveLength(1);

      // One cached action_jobs row, verb=unsubscribe, status=done.
      const jobs = await db
        .select()
        .from(actionJobs)
        .where(eq(actionJobs.idempotencyKey, 'unsub:shared-replay-key'));
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.verb).toBe('unsubscribe');
      expect(jobs[0]!.status).toBe('done');
      // resolved_message_ids carries the cached activity_log id so the
      // replay can project it back into the response shape.
      expect(jobs[0]!.resolvedMessageIds).toEqual([first.activityLogId]);
    });

    it('namespaces the key so an unsub-intent dedup never collides with a worker job key', async () => {
      // The same raw key the FE generates for unsubscribe might collide
      // with one a worker enqueue uses (clients see one Idempotency-
      // Key per click, regardless of verb). The 'unsub:' prefix prevents
      // the cross-verb collision; this test asserts both rows can
      // coexist.
      const result = await svc.recordUnsubscribeIntent({
        mailboxAccountId: mailboxId,
        senderId,
        idempotencyKey: 'shared-raw-key',
      });
      expect(result.activityLogId).toBeDefined();
      const jobs = await db.select().from(actionJobs);
      // The unsubscribe row's key is the namespaced one.
      const unsubRow = jobs.find((j) => j.verb === 'unsubscribe');
      expect(unsubRow?.idempotencyKey).toBe('unsub:shared-raw-key');
      // A future worker enqueue with the raw 'shared-raw-key' would
      // hit a DIFFERENT idempotency_key value, so no UNIQUE collision.
    });

    it('404s a sender that does not exist in this mailbox', async () => {
      // Bogus UUID — never seeded. The resolveSenderKey path returns
      // 404 SENDER_NOT_FOUND for any id-mailbox combination that
      // misses the sender ownership join.
      await expect(
        svc.recordUnsubscribeIntent({
          mailboxAccountId: mailboxId,
          senderId: '00000000-0000-4000-8000-000000000000',
          idempotencyKey: 'unsub-bogus-key',
        }),
      ).rejects.toMatchObject({ response: { code: 'SENDER_NOT_FOUND' } });
    });

    it('records a no-channel preference without consuming a Free cleanup unit', async () => {
      await db
        .update(senders)
        .set({ unsubscribeMethod: 'none', unsubscribeUrl: null })
        .where(eq(senders.id, senderId));

      const result = await svc.recordUnsubscribeIntent({
        mailboxAccountId: mailboxId,
        senderId,
        idempotencyKey: 'unsub-no-channel',
      });

      expect(result.method).toBe('none');
      const [intent] = await db
        .select({ status: actionJobs.status })
        .from(actionJobs)
        .where(eq(actionJobs.idempotencyKey, 'unsub:unsub-no-channel'));
      expect(intent?.status).toBe('failed');
      const [mailbox] = await db
        .select({ workspaceId: mailboxAccounts.workspaceId })
        .from(mailboxAccounts)
        .where(eq(mailboxAccounts.id, mailboxId));
      await expect(
        new EntitlementsService(db as never).cleanupSummary(mailbox!.workspaceId),
      ).resolves.toMatchObject({ used: 0, remaining: 5 });
    });
  });

  describe('recordUnsubscribeIntent — execution wiring (D9 Wave 2)', () => {
    let unsubQueue: ReturnType<typeof fakeQueue>;

    /** Service with BOTH queues wired (label + unsub-execution). */
    function svcWithUnsubQueue(): ActionsService {
      unsubQueue = fakeQueue();
      return new ActionsService(db as never, queue as never, undefined, unsubQueue as never);
    }

    async function setSenderMethod(
      method: 'one_click' | 'mailto' | 'none' | null,
      url: string | null,
    ): Promise<void> {
      await db
        .update(senders)
        .set({ unsubscribeMethod: method, unsubscribeUrl: url })
        .where(eq(senders.id, senderId));
    }

    it('one_click: returns the execution handle, persists the queued execution row, sets unsub_status=pending, enqueues', async () => {
      await setSenderMethod('one_click', 'https://unsub.shop.example/oc?u=1');
      const service = svcWithUnsubQueue();

      const result = await service.recordUnsubscribeIntent({
        mailboxAccountId: mailboxId,
        senderId,
        idempotencyKey: 'click-unsub-1',
      });

      expect(result.method).toBe('one_click');
      expect(result.mailtoUrl).toBeNull();
      expect(result.executionActionId).toMatch(/^[0-9a-f-]{36}$/);

      // Execution row: queued, verb=unsubscribe, ONE-sender semantics.
      const [execRow] = await db
        .select()
        .from(actionJobs)
        .where(eq(actionJobs.idempotencyKey, 'unsubexec-click-unsub-1'));
      expect(execRow!.id).toBe(result.executionActionId);
      expect(execRow!.status).toBe('queued');
      expect(execRow!.requestedCount).toBe(1);
      expect(execRow!.undoToken).toBeNull(); // D58 — never an undo token

      // Policy chip state: pending until the worker records the outcome.
      const [policy] = await db
        .select()
        .from(senderPolicies)
        .where(eq(senderPolicies.mailboxAccountId, mailboxId));
      expect(policy!.unsubStatus).toBe('pending');

      // Enqueued on the UNSUB queue (not the label queue), jobId = row key.
      expect(unsubQueue.count).toBe(1);
      expect(unsubQueue.jobIds).toEqual(['unsubexec-click-unsub-1']);
      expect(queue.count).toBe(0);
    });

    it('one_click replay: the SAME Idempotency-Key returns the same execution handle; the wire sees ONE job (jobId dedup)', async () => {
      await setSenderMethod('one_click', 'https://unsub.shop.example/oc?u=1');
      const service = svcWithUnsubQueue();

      const first = await service.recordUnsubscribeIntent({
        mailboxAccountId: mailboxId,
        senderId,
        idempotencyKey: 'replay-unsub-key',
      });
      const second = await service.recordUnsubscribeIntent({
        mailboxAccountId: mailboxId,
        senderId,
        idempotencyKey: 'replay-unsub-key',
      });

      expect(second.executionActionId).toBe(first.executionActionId);
      expect(second.activityLogId).toBe(first.activityLogId);
      expect(second.method).toBe('one_click');
      // The replay re-adds while the row is still 'queued' (crash-window
      // self-heal below), but BullMQ's duplicate-jobId no-op means ONE
      // execution per intent ever reaches the wire.
      expect(unsubQueue.count).toBe(1);

      const execRows = await db
        .select()
        .from(actionJobs)
        .where(eq(actionJobs.idempotencyKey, 'unsubexec-replay-unsub-key'));
      expect(execRows).toHaveLength(1);
    });

    it('rejects a cross-mailbox key reuse without leaking cached handles or self-healing the foreign queue job', async () => {
      await setSenderMethod('one_click', 'https://unsub.shop.example/oc?u=local');
      const [owner] = await db
        .select({
          workspaceId: mailboxAccounts.workspaceId,
          userId: mailboxAccounts.userId,
        })
        .from(mailboxAccounts)
        .where(eq(mailboxAccounts.id, mailboxId));
      const [foreignMailbox] = await db
        .insert(mailboxAccounts)
        .values({
          workspaceId: owner!.workspaceId,
          userId: owner!.userId,
          provider: 'gmail',
          providerAccountId: 'foreign@x',
        })
        .returning({ id: mailboxAccounts.id });
      const foreignSenderId = await seedSender(db, foreignMailbox!.id);
      await db
        .update(senders)
        .set({
          unsubscribeMethod: 'one_click',
          unsubscribeUrl: 'https://unsub.shop.example/oc?u=foreign',
        })
        .where(eq(senders.id, foreignSenderId));
      const service = svcWithUnsubQueue();

      const foreignResult = await service.recordUnsubscribeIntent({
        mailboxAccountId: foreignMailbox!.id,
        senderId: foreignSenderId,
        idempotencyKey: 'cross-mailbox-unsub-key',
      });
      const before = {
        policies: await db.select().from(senderPolicies),
        activity: await db.select().from(activityLog),
        jobs: await db.select().from(actionJobs),
        outbox: await db.select().from(outboxEvents),
      };

      // Model the crash window the old global cache lookup would
      // incorrectly self-heal using the LOCAL mailbox/sender context.
      unsubQueue.count = 0;
      unsubQueue.jobIds = [];
      const caught: unknown = await service
        .recordUnsubscribeIntent({
          mailboxAccountId: mailboxId,
          senderId,
          idempotencyKey: 'cross-mailbox-unsub-key',
        })
        .catch((error: unknown) => error);

      expect(caught).toBeInstanceOf(ConflictException);
      const conflict = caught as ConflictException;
      expect(conflict.getStatus()).toBe(409);
      expect(conflict.getResponse()).toEqual({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message: 'Idempotency-Key already used by a different request.',
      });
      const publicError = JSON.stringify(conflict.getResponse());
      expect(publicError).not.toContain(foreignResult.activityLogId);
      expect(publicError).not.toContain(foreignResult.recordedAt);
      expect(publicError).not.toContain(foreignResult.executionActionId!);
      expect(unsubQueue.count).toBe(0);
      expect(unsubQueue.jobIds).toEqual([]);
      expect({
        policies: await db.select().from(senderPolicies),
        activity: await db.select().from(activityLog),
        jobs: await db.select().from(actionJobs),
        outbox: await db.select().from(outboxEvents),
      }).toEqual(before);
    });

    it('rejects same-mailbox key reuse for a different sender without echoing the first sender action', async () => {
      await setSenderMethod('one_click', 'https://unsub.shop.example/oc?u=first');
      const secondSenderId = await seedSecondSender(db, mailboxId);
      await db
        .update(senders)
        .set({
          unsubscribeMethod: 'one_click',
          unsubscribeUrl: 'https://unsub.brand.example/oc?u=second',
        })
        .where(eq(senders.id, secondSenderId));
      const service = svcWithUnsubQueue();

      const firstResult = await service.recordUnsubscribeIntent({
        mailboxAccountId: mailboxId,
        senderId,
        idempotencyKey: 'same-mailbox-other-sender-key',
      });
      const before = {
        policies: await db.select().from(senderPolicies),
        activity: await db.select().from(activityLog),
        jobs: await db.select().from(actionJobs),
        outbox: await db.select().from(outboxEvents),
      };
      unsubQueue.count = 0;
      unsubQueue.jobIds = [];

      const caught: unknown = await service
        .recordUnsubscribeIntent({
          mailboxAccountId: mailboxId,
          senderId: secondSenderId,
          idempotencyKey: 'same-mailbox-other-sender-key',
          // Replays ignore this hint, but a different sender is not a
          // replay and must conflict before the two-unit preflight.
          includesBacklogAction: true,
        })
        .catch((error: unknown) => error);

      expect(caught).toBeInstanceOf(ConflictException);
      const conflict = caught as ConflictException;
      expect(conflict.getStatus()).toBe(409);
      expect(conflict.getResponse()).toEqual({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message: 'Idempotency-Key already used by a different request.',
      });
      const publicError = JSON.stringify(conflict.getResponse());
      expect(publicError).not.toContain(firstResult.activityLogId);
      expect(publicError).not.toContain(firstResult.recordedAt);
      expect(publicError).not.toContain(firstResult.executionActionId!);
      expect(unsubQueue.count).toBe(0);
      expect(unsubQueue.jobIds).toEqual([]);
      expect({
        policies: await db.select().from(senderPolicies),
        activity: await db.select().from(activityLog),
        jobs: await db.select().from(actionJobs),
        outbox: await db.select().from(outboxEvents),
      }).toEqual(before);
    });

    it('one_click replay re-enqueues an orphaned queued execution row (crash between commit and enqueue)', async () => {
      await setSenderMethod('one_click', 'https://unsub.shop.example/oc?u=1');
      const service = svcWithUnsubQueue();

      const first = await service.recordUnsubscribeIntent({
        mailboxAccountId: mailboxId,
        senderId,
        idempotencyKey: 'orphan-unsub-key',
      });

      // Simulate the crash window: the tx committed (execution row
      // 'queued', policy 'pending') but the process died before the
      // post-commit enqueue — Redis has NO job behind the row.
      unsubQueue.count = 0;
      unsubQueue.jobIds = [];

      const replay = await service.recordUnsubscribeIntent({
        mailboxAccountId: mailboxId,
        senderId,
        idempotencyKey: 'orphan-unsub-key',
      });
      expect(replay.executionActionId).toBe(first.executionActionId);
      expect(unsubQueue.count).toBe(1); // the orphan self-healed
      expect(unsubQueue.jobIds).toEqual(['unsubexec-orphan-unsub-key']);

      // Once the worker has flipped the row terminal, a replay must NOT
      // re-enqueue — the list processor was already asked once.
      await db
        .update(actionJobs)
        .set({ status: 'done' })
        .where(eq(actionJobs.idempotencyKey, 'unsubexec-orphan-unsub-key'));
      unsubQueue.count = 0;
      unsubQueue.jobIds = [];
      await service.recordUnsubscribeIntent({
        mailboxAccountId: mailboxId,
        senderId,
        idempotencyKey: 'orphan-unsub-key',
      });
      expect(unsubQueue.count).toBe(0);
    });

    it('mailto: returns the mailto URL for the manual compose path; NO execution, NO pending status (D230)', async () => {
      await setSenderMethod('mailto', 'mailto:opt-out@shop.example?subject=unsubscribe');
      const service = svcWithUnsubQueue();

      const result = await service.recordUnsubscribeIntent({
        mailboxAccountId: mailboxId,
        senderId,
        idempotencyKey: 'mailto-unsub-1',
      });

      expect(result.method).toBe('mailto');
      expect(result.mailtoUrl).toBe('mailto:opt-out@shop.example?subject=unsubscribe');
      expect(result.executionActionId).toBeNull();
      expect(unsubQueue.count).toBe(0); // D230 hard guardrail — no auto-send

      const [policy] = await db
        .select()
        .from(senderPolicies)
        .where(eq(senderPolicies.mailboxAccountId, mailboxId));
      expect(policy!.policyType).toBe('unsubscribe');
      expect(policy!.unsubStatus).toBeNull(); // no claimed outcome
    });

    it('none: decision recorded, nothing to execute', async () => {
      await setSenderMethod('none', null);
      const service = svcWithUnsubQueue();

      const result = await service.recordUnsubscribeIntent({
        mailboxAccountId: mailboxId,
        senderId,
        idempotencyKey: 'none-unsub-1',
      });

      expect(result.method).toBe('none');
      expect(result.mailtoUrl).toBeNull();
      expect(result.executionActionId).toBeNull();
      expect(unsubQueue.count).toBe(0);
    });

    it('one_click missing its URL degrades to none (defensive — ADR-0006 says the pair always agrees)', async () => {
      await setSenderMethod('one_click', null);
      const service = svcWithUnsubQueue();

      const result = await service.recordUnsubscribeIntent({
        mailboxAccountId: mailboxId,
        senderId,
        idempotencyKey: 'broken-pair-1',
      });
      expect(result.method).toBe('none');
      expect(result.executionActionId).toBeNull();
      expect(unsubQueue.count).toBe(0);
    });

    it('503 QUEUE_UNAVAILABLE before ANY write when the unsub queue is down and the sender is one_click', async () => {
      await setSenderMethod('one_click', 'https://unsub.shop.example/oc?u=1');
      const noUnsubQueue = new ActionsService(db as never, queue as never);

      await expect(
        noUnsubQueue.recordUnsubscribeIntent({
          mailboxAccountId: mailboxId,
          senderId,
          idempotencyKey: 'no-queue-1',
        }),
      ).rejects.toMatchObject({ response: { code: 'QUEUE_UNAVAILABLE' } });

      // No half-written state: no policy row, no audit row, no jobs.
      expect(await db.select().from(senderPolicies)).toHaveLength(0);
      expect(await db.select().from(activityLog)).toHaveLength(0);
      expect(await db.select().from(actionJobs)).toHaveLength(0);
    });

    it('intent event carries the method so the senders consumer can project pending', async () => {
      await setSenderMethod('one_click', 'https://unsub.shop.example/oc?u=1');
      const service = svcWithUnsubQueue();
      await service.recordUnsubscribeIntent({
        mailboxAccountId: mailboxId,
        senderId,
        idempotencyKey: 'event-method-1',
      });
      const events = await db.select().from(outboxEvents);
      const intent = events.find((e) => e.topic === 'actions.unsubscribe_intent_recorded');
      expect(intent?.payload).toMatchObject({ method: 'one_click' });
    });
  });

  describe('recordKeepIntent (D40 + D226 triage wiring)', () => {
    it('writes a 0-affected keep activity row + the triage.verdict_applied outbox event', async () => {
      const result = await svc.recordKeepIntent({ mailboxAccountId: mailboxId, senderId });
      expect(result.senderId).toBe(senderId);
      expect(result.activityLogId).toMatch(/^[0-9a-f-]{36}$/);

      // activity_log: 0-affected keep row, no undo token (Keep is a
      // no-op to undo — D35).
      const acts = await db
        .select()
        .from(activityLog)
        .where(eq(activityLog.mailboxAccountId, mailboxId));
      expect(acts).toHaveLength(1);
      expect(acts[0]!.action).toBe('keep');
      expect(acts[0]!.affectedCount).toBe(0);
      expect(acts[0]!.undoToken).toBeNull();
      expect(acts[0]!.senderKey).toBe(SENDER_KEY);

      // The cross-feature policy write is the EVENT (D204) — the
      // service never touches sender_policies directly. No dual-write
      // backstop here (nothing reads the keep policy synchronously).
      const policies = await db
        .select()
        .from(senderPolicies)
        .where(eq(senderPolicies.mailboxAccountId, mailboxId));
      expect(policies).toHaveLength(0);

      const events = await db.select().from(outboxEvents);
      expect(events).toHaveLength(1);
      expect(events[0]!.topic).toBe('triage.verdict_applied');
      expect(events[0]!.payload).toMatchObject({
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY,
        verdict: 'keep',
        affectedCount: 0,
        undoToken: null,
      });
    });

    it('replays an existing keep decision inside the decided window (semantic idempotency)', async () => {
      const first = await svc.recordKeepIntent({ mailboxAccountId: mailboxId, senderId });
      const second = await svc.recordKeepIntent({ mailboxAccountId: mailboxId, senderId });
      expect(second.activityLogId).toBe(first.activityLogId);
      expect(second.recordedAt).toBe(first.recordedAt);

      // ONE audit row, ONE outbox event — the replay writes nothing.
      const acts = await db
        .select()
        .from(activityLog)
        .where(eq(activityLog.mailboxAccountId, mailboxId));
      expect(acts).toHaveLength(1);
      const events = await db.select().from(outboxEvents);
      expect(events).toHaveLength(1);
    });

    it('a keep decision OLDER than the window is a fresh decision, not a replay', async () => {
      await db.insert(activityLog).values({
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY,
        source: 'manual',
        action: 'keep',
        affectedCount: 0,
        undoToken: null,
        occurredAt: daysAgo(8),
      });
      const result = await svc.recordKeepIntent({ mailboxAccountId: mailboxId, senderId });
      const acts = await db
        .select()
        .from(activityLog)
        .where(eq(activityLog.mailboxAccountId, mailboxId));
      expect(acts).toHaveLength(2);
      // The fresh row is the one returned.
      const fresh = acts.find((a) => a.id === result.activityLogId);
      expect(fresh).toBeDefined();
    });

    it('404s a sender that does not exist in this mailbox', async () => {
      await expect(
        svc.recordKeepIntent({
          mailboxAccountId: mailboxId,
          senderId: '00000000-0000-4000-8000-000000000000',
        }),
      ).rejects.toMatchObject({ response: { code: 'SENDER_NOT_FOUND' } });
    });
  });
});
