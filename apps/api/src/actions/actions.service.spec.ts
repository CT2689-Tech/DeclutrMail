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
  internalDate: Date = new Date('2026-05-01'),
): Promise<void> {
  await db.insert(mailMessages).values({
    mailboxAccountId,
    providerMessageId: pid,
    providerThreadId: `t-${pid}`,
    senderKey: SENDER_KEY,
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
 * Fake BullMQ queue — records enqueues AND mirrors BullMQ's real jobId
 * validation: a custom id containing `:` is rejected (BullMQ reserves it
 * as its Redis key separator). Without this the fake would let a colon
 * jobId through and the bug only surfaces against a live Redis.
 */
function fakeQueue() {
  const q = {
    count: 0,
    jobIds: [] as string[],
    add: async (_job: unknown, _data: unknown, opts: { jobId?: string }) => {
      if (opts?.jobId && opts.jobId.includes(':')) {
        throw new Error('Custom Id cannot contain :');
      }
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
    expect(queue.jobIds).toEqual([`revert-${token}`]);
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
      //   monthly  = inbox messages WITHIN last 30 days = m-2d → 1
      expect(res.counts).toEqual({
        all: 5,
        olderThan30d: 4,
        olderThan90d: 3,
        olderThan180d: 2,
        olderThan365d: 1,
      });
      expect(res.sender.monthly).toBe(1);
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
      await db
        .insert(senderPolicies)
        .values({ mailboxAccountId: mailboxId, senderKey: SENDER_KEY, isProtected: true });
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
      await db
        .insert(senderPolicies)
        .values({ mailboxAccountId: mailboxId, senderKey: SENDER_KEY, isProtected: true });
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
});
