import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  actionJobs,
  mailboxAccounts,
  mailMessages,
  schema,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { ActionsService } from '../../actions/actions.service.js';
import { AppException } from '../app-exception.js';
import { EntitlementsService } from './entitlements.service.js';

/**
 * EntitlementsService integration tests (D19/D77/D81) — real service
 * against in-process PGlite. Pins the COUNTING RULE (one cleanup unit
 * per sender per enqueue; composites = 1; bulk of N = N; intents +
 * reverses + failures exempt; undo never refunds), the 402 gates, and
 * the inbox limit — including the end-to-end leg through
 * `ActionsService` (the 6th cleanup action 402s; a replayed key does
 * not).
 */

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'migrations',
);

type Db = ReturnType<typeof drizzle<typeof schema>>;

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

async function seedWorkspace(
  db: Db,
  tier: 'free' | 'plus' | 'pro' = 'free',
): Promise<{ workspaceId: string; mailboxId: string; userId: string }> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'WS', tier })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: `o-${tier}@declutrmail.ai` })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: `o-${tier}@x`,
    })
    .returning({ id: mailboxAccounts.id });
  return { workspaceId: ws!.id, mailboxId: mailbox!.id, userId: user!.id };
}

let senderSeq = 0;
async function seedSender(db: Db, mailboxAccountId: string): Promise<{ id: string; key: string }> {
  senderSeq += 1;
  const key = senderSeq.toString(16).padStart(64, '0');
  const [s] = await db
    .insert(senders)
    .values({
      mailboxAccountId,
      senderKey: key,
      email: `news-${senderSeq}@shop.example`,
      domain: 'shop.example',
      gmailCategory: 'promotions',
      firstSeenAt: new Date('2026-01-01'),
      lastSeenAt: new Date('2026-05-01'),
    })
    .returning({ id: senders.id });
  return { id: s!.id, key };
}

async function seedInboxMessage(
  db: Db,
  mailboxAccountId: string,
  senderKey: string,
  pid: string,
): Promise<void> {
  await db.insert(mailMessages).values({
    mailboxAccountId,
    providerMessageId: pid,
    providerThreadId: `t-${pid}`,
    senderKey,
    internalDate: new Date('2026-05-01'),
    isUnread: false,
    labelIds: ['INBOX'],
  });
}

/** Insert a forward action_jobs row directly (counting-rule fixtures). */
async function seedJob(
  db: Db,
  mailboxAccountId: string,
  input: {
    verb: 'archive' | 'later' | 'delete' | 'unsubscribe';
    key: string;
    senderId?: string;
    senderKey?: string;
    compositeId?: string;
    direction?: 'forward' | 'reverse';
    status?: 'queued' | 'executing' | 'done' | 'failed';
    affectedCount?: number;
  },
): Promise<string> {
  const [row] = await db
    .insert(actionJobs)
    .values({
      mailboxAccountId,
      verb: input.verb,
      direction: input.direction ?? 'forward',
      selector: input.senderId
        ? { type: 'sender', senderId: input.senderId, senderKey: input.senderKey ?? 'k' }
        : { type: 'messages' },
      resolvedMessageIds: [],
      requestedCount: 1,
      // Default to an EFFECTIVE action (moved ≥1 message); a no-op test
      // passes affectedCount: 0 explicitly.
      affectedCount: input.affectedCount ?? 1,
      status: input.status ?? 'done',
      idempotencyKey: input.key,
      ...(input.compositeId ? { compositeId: input.compositeId } : {}),
    })
    .returning({ id: actionJobs.id });
  return row!.id;
}

/** Minimal fake queue (mirrors the actions spec contract). */
function fakeQueue() {
  return {
    count: 0,
    add: async (_j: unknown, _d: unknown, _o: { jobId?: string }) => {
      // no-op
    },
    getJob: async () => null,
  };
}

describe('EntitlementsService — counting rule (D19/D77)', () => {
  let db: Db;
  let workspaceId: string;
  let mailboxId: string;
  let svc: EntitlementsService;

  beforeEach(async () => {
    db = await freshDb();
    ({ workspaceId, mailboxId } = await seedWorkspace(db, 'free'));
    svc = new EntitlementsService(db as never);
  });

  it('a composite (primary + secondary, one sender) is ONE unit', async () => {
    const sender = await seedSender(db, mailboxId);
    const primaryId = await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'archive-k1',
      senderId: sender.id,
      senderKey: sender.key,
    });
    await seedJob(db, mailboxId, {
      verb: 'delete',
      key: 'delete-k1-sec',
      senderId: sender.id,
      senderKey: sender.key,
      compositeId: primaryId,
    });
    expect(await svc.cleanupUnitsUsed(workspaceId)).toBe(1);
  });

  it('a bulk of 3 senders is THREE units (anchor + linked rows)', async () => {
    const [s1, s2, s3] = [
      await seedSender(db, mailboxId),
      await seedSender(db, mailboxId),
      await seedSender(db, mailboxId),
    ];
    const anchor = await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'archive-bulk-1',
      senderId: s1.id,
      senderKey: s1.key,
    });
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'archive-bulk-2',
      senderId: s2.id,
      senderKey: s2.key,
      compositeId: anchor,
    });
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'archive-bulk-3',
      senderId: s3.id,
      senderKey: s3.key,
      compositeId: anchor,
    });
    expect(await svc.cleanupUnitsUsed(workspaceId)).toBe(3);
  });

  it('two separate clicks on the SAME sender are TWO units', async () => {
    const sender = await seedSender(db, mailboxId);
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'archive-click1',
      senderId: sender.id,
      senderKey: sender.key,
    });
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'archive-click2',
      senderId: sender.id,
      senderKey: sender.key,
    });
    expect(await svc.cleanupUnitsUsed(workspaceId)).toBe(2);
  });

  it('unsubscribe-intent rows, reverse rows, and failed rows are exempt; undo never refunds', async () => {
    const sender = await seedSender(db, mailboxId);
    // Intent dedup row (policy write — not a label-pipeline verb).
    await seedJob(db, mailboxId, {
      verb: 'unsubscribe',
      key: 'unsub:click1',
      senderId: sender.id,
      senderKey: sender.key,
    });
    // A counted forward archive…
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'archive-x1',
      senderId: sender.id,
      senderKey: sender.key,
    });
    // …whose undo (reverse row) does NOT refund it.
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'revert-token-1',
      direction: 'reverse',
    });
    // A failed forward enqueue never consumed the quota.
    await seedJob(db, mailboxId, {
      verb: 'delete',
      key: 'delete-failed-1',
      senderId: sender.id,
      senderKey: sender.key,
      status: 'failed',
    });
    expect(await svc.cleanupUnitsUsed(workspaceId)).toBe(1);
  });

  it('a no-op cleanup (done, 0 messages moved) consumes NO unit; in-flight still counts', async () => {
    const s1 = await seedSender(db, mailboxId);
    const s2 = await seedSender(db, mailboxId);
    const s3 = await seedSender(db, mailboxId);
    // Effective action — moved 1 message → counts.
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'eff-1',
      senderId: s1.id,
      senderKey: s1.key,
      affectedCount: 1,
    });
    // No-op — done but moved nothing → must NOT count (the bug fix).
    await seedJob(db, mailboxId, {
      verb: 'delete',
      key: 'noop-1',
      senderId: s2.id,
      senderKey: s2.key,
      status: 'done',
      affectedCount: 0,
    });
    // In-flight — queued with the 0 default → still counts (intent about
    // to move mail), so the no-op exclusion can't be bypassed mid-flight.
    await seedJob(db, mailboxId, {
      verb: 'later',
      key: 'queued-1',
      senderId: s3.id,
      senderKey: s3.key,
      status: 'queued',
      affectedCount: 0,
    });
    expect(await svc.cleanupUnitsUsed(workspaceId)).toBe(2);
  });

  it('cleanupSummary: free reports limit 5 + remaining; pro is unlimited (no scan)', async () => {
    const sender = await seedSender(db, mailboxId);
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'archive-s1',
      senderId: sender.id,
      senderKey: sender.key,
    });
    expect(await svc.cleanupSummary(workspaceId)).toEqual({
      tier: 'free',
      limit: 5,
      used: 1,
      remaining: 4,
    });

    const pro = await seedWorkspace(db, 'pro');
    expect(await svc.cleanupSummary(pro.workspaceId)).toEqual({
      tier: 'pro',
      limit: null,
      used: 0,
      remaining: null,
    });
  });

  it('assertCleanupCapacity: 402 FREE_CAP_REACHED with details at the cap; passes under it', async () => {
    const sender = await seedSender(db, mailboxId);
    for (let i = 0; i < 4; i++) {
      await seedJob(db, mailboxId, {
        verb: 'archive',
        key: `archive-fill-${i}`,
        senderId: sender.id,
        senderKey: sender.key,
      });
    }
    // 4 used, 1 left — one more unit fits…
    await expect(svc.assertCleanupCapacity(mailboxId, 1)).resolves.toBeUndefined();
    // …but a bulk needing 2 does not (the mid-selection 402).
    const err = await svc.assertCleanupCapacity(mailboxId, 2).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('FREE_CAP_REACHED');
    expect((err as AppException).getStatus()).toBe(402);
    expect((err as AppException).details).toEqual({
      remaining: 1,
      limit: 5,
      used: 4,
      requiredUnits: 2,
    });
  });

  it('assertCleanupCapacity: unlimited tiers never throw', async () => {
    const plus = await seedWorkspace(db, 'plus');
    await expect(svc.assertCleanupCapacity(plus.mailboxId, 1000)).resolves.toBeUndefined();
  });
});

describe('EntitlementsService — inbox limit (D19/D81)', () => {
  let db: Db;
  let svc: EntitlementsService;

  beforeEach(async () => {
    db = await freshDb();
    svc = new EntitlementsService(db as never);
  });

  it('free (limit 1): 402 INBOX_LIMIT_REACHED once one mailbox is connected', async () => {
    const { workspaceId } = await seedWorkspace(db, 'free');
    const err = await svc.assertCanConnectMailbox(workspaceId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('INBOX_LIMIT_REACHED');
    expect((err as AppException).getStatus()).toBe(402);
    expect((err as AppException).details).toEqual({ limit: 1, connected: 1, tier: 'free' });
  });

  it('counts CONNECTED mailboxes only — a disconnected row frees its slot', async () => {
    const { workspaceId, mailboxId } = await seedWorkspace(db, 'free');
    await db
      .update(mailboxAccounts)
      .set({ status: 'disconnected' })
      .where(eq(mailboxAccounts.id, mailboxId));
    await expect(svc.assertCanConnectMailbox(workspaceId)).resolves.toBeUndefined();
  });

  it('pro (limit 2): allows the 2nd, blocks the 3rd', async () => {
    const { workspaceId, userId } = await seedWorkspace(db, 'pro');
    await expect(svc.assertCanConnectMailbox(workspaceId)).resolves.toBeUndefined();
    await db.insert(mailboxAccounts).values({
      workspaceId,
      userId,
      provider: 'gmail',
      providerAccountId: 'second@x',
    });
    const err = await svc.assertCanConnectMailbox(workspaceId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('INBOX_LIMIT_REACHED');
  });
});

describe('ActionsService free-cap enforcement (end-to-end, D19/D77)', () => {
  let db: Db;
  let mailboxId: string;

  beforeEach(async () => {
    db = await freshDb();
    ({ mailboxId } = await seedWorkspace(db, 'free'));
  });

  function service(): ActionsService {
    return new ActionsService(db as never, fakeQueue() as never);
  }

  it('the 6th cleanup action 402s with the FREE_CAP_REACHED envelope; replay of a spent key does not', async () => {
    const svc = service();
    // Five fresh single-sender composites — exactly the lifetime quota.
    for (let i = 0; i < 5; i++) {
      const sender = await seedSender(db, mailboxId);
      await seedInboxMessage(db, mailboxId, sender.key, `m-${i}`);
      await svc.enqueueComposite({
        mailboxAccountId: mailboxId,
        selector: { type: 'sender', senderId: sender.id },
        primary: { type: 'archive', olderThanDays: null },
        idempotencyKey: `click-${i}`,
        override: false,
      });
    }
    // The 6th fresh enqueue is denied…
    const sixth = await seedSender(db, mailboxId);
    const err = await svc
      .enqueueComposite({
        mailboxAccountId: mailboxId,
        selector: { type: 'sender', senderId: sixth.id },
        primary: { type: 'archive', olderThanDays: null },
        idempotencyKey: 'click-6',
        override: false,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('FREE_CAP_REACHED');
    expect((err as AppException).getStatus()).toBe(402);
    expect((err as AppException).details).toMatchObject({ remaining: 0, limit: 5, used: 5 });

    // …but a network-retried click of action #4 replays, never 402s.
    const replayedSender = await db
      .select()
      .from(actionJobs)
      .where(eq(actionJobs.idempotencyKey, 'archive-click-3'))
      .limit(1);
    expect(replayedSender).toHaveLength(1);
    const replay = await svc.enqueueComposite({
      mailboxAccountId: mailboxId,
      selector: replayedSender[0]!.selector as { type: 'sender'; senderId: string },
      primary: { type: 'archive', olderThanDays: null },
      idempotencyKey: 'click-3',
      override: false,
    });
    expect(replay.actionId).toBe(replayedSender[0]!.id);
  });

  it('keep-intent stays exempt at the cap (policy write, never gated)', async () => {
    const svc = service();
    const sender = await seedSender(db, mailboxId);
    for (let i = 0; i < 5; i++) {
      await seedJob(db, mailboxId, {
        verb: 'archive',
        key: `archive-fill-${i}`,
        senderId: sender.id,
        senderKey: sender.key,
      });
    }
    const keep = await svc.recordKeepIntent({ mailboxAccountId: mailboxId, senderId: sender.id });
    expect(keep.activityLogId).toBeTruthy();
  });

  it('bulk needing more units than remain 402s BEFORE writing any row', async () => {
    const svc = service();
    const filler = await seedSender(db, mailboxId);
    for (let i = 0; i < 4; i++) {
      await seedJob(db, mailboxId, {
        verb: 'archive',
        key: `archive-fill-${i}`,
        senderId: filler.id,
        senderKey: filler.key,
      });
    }
    const s1 = await seedSender(db, mailboxId);
    const s2 = await seedSender(db, mailboxId);
    await seedInboxMessage(db, mailboxId, s1.key, 'b1');
    await seedInboxMessage(db, mailboxId, s2.key, 'b2');

    const before = await db.select({ id: actionJobs.id }).from(actionJobs);
    const err = await svc
      .enqueueBulkComposite({
        mailboxAccountId: mailboxId,
        senderIds: [s1.id, s2.id],
        primary: { type: 'archive', olderThanDays: null },
        idempotencyKey: 'bulk-click-1',
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('FREE_CAP_REACHED');
    const after = await db.select({ id: actionJobs.id }).from(actionJobs);
    expect(after.length).toBe(before.length); // nothing was written
  });
});
