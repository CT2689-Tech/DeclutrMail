import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  actionJobs,
  activityLog,
  mailboxAccounts,
  mailMessages,
  schema,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

async function freshDb(queryLog?: string[]): Promise<Db> {
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
  return drizzle(pg, {
    schema,
    ...(queryLog
      ? {
          logger: {
            logQuery(query: string): void {
              queryLog.push(query);
            },
          },
        }
      : {}),
  });
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
      unsubscribeMethod: 'mailto',
      unsubscribeUrl: `mailto:unsubscribe-${senderSeq}@shop.example`,
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
  let queryLog: string[];

  beforeEach(async () => {
    queryLog = [];
    db = await freshDb(queryLog);
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

  it('counts unsubscribe intent rows but excludes execution, reverse, and failed rows; undo never refunds', async () => {
    const sender = await seedSender(db, mailboxId);
    // Intent dedup row — one user cleanup decision, even though the
    // durable intent itself moves zero messages.
    await seedJob(db, mailboxId, {
      verb: 'unsubscribe',
      key: 'unsub:click1',
      senderId: sender.id,
      senderKey: sender.key,
      affectedCount: 0,
    });
    // One-click execution bookkeeping for that SAME intent must not
    // consume a second unit.
    await seedJob(db, mailboxId, {
      verb: 'unsubscribe',
      key: 'unsubexec-click1',
      senderId: sender.id,
      senderKey: sender.key,
      status: 'queued',
      affectedCount: 0,
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
    expect(await svc.cleanupUnitsUsed(workspaceId)).toBe(2);
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

  it('lockCleanupWorkspace: paid tiers use the lookup fast path without FOR UPDATE', async () => {
    const plus = await seedWorkspace(db, 'plus');
    queryLog.length = 0;

    await expect(svc.lockCleanupWorkspace(plus.mailboxId)).resolves.toEqual({
      workspaceId: plus.workspaceId,
      tier: 'plus',
    });
    expect(queryLog.join('\n')).not.toMatch(/for update/i);
  });

  it('lockCleanupWorkspace: a finite-tier observation locks the row and returns its re-read tier', async () => {
    const plus = await seedWorkspace(db, 'plus');
    const lookup = vi.spyOn(svc, 'workspaceForMailbox').mockResolvedValueOnce({
      workspaceId: plus.workspaceId,
      // Simulate the tier observed before waiting for the row lock. The
      // locking query must return the current persisted tier instead.
      tier: 'free',
    });
    queryLog.length = 0;

    await expect(svc.lockCleanupWorkspace(plus.mailboxId)).resolves.toEqual({
      workspaceId: plus.workspaceId,
      tier: 'plus',
    });
    expect(queryLog.join('\n')).toMatch(/for update/i);
    lookup.mockRestore();
  });

  it('assertCleanupCapacity threads a supplied transaction through lookup and count', async () => {
    const sender = await seedSender(db, mailboxId);
    for (let i = 0; i < 4; i++) {
      await seedJob(db, mailboxId, {
        verb: 'archive',
        key: `archive-executor-${i}`,
        senderId: sender.id,
        senderKey: sender.key,
      });
    }
    const lookup = vi.spyOn(svc, 'workspaceForMailbox');
    const countUsed = vi.spyOn(svc, 'cleanupUnitsUsed');

    await db.transaction(async (tx) => {
      await expect(svc.assertCleanupCapacity(mailboxId, 1, tx as never)).resolves.toBeUndefined();
      expect(lookup).toHaveBeenCalledWith(mailboxId, tx);
      expect(countUsed).toHaveBeenCalledWith(workspaceId, tx);
    });
    lookup.mockRestore();
    countUsed.mockRestore();
  });

  it('assertCleanupCapacityForWorkspace reuses a locked workspace without another lock query', async () => {
    const sender = await seedSender(db, mailboxId);
    for (let i = 0; i < 4; i++) {
      await seedJob(db, mailboxId, {
        verb: 'archive',
        key: `archive-locked-executor-${i}`,
        senderId: sender.id,
        senderKey: sender.key,
      });
    }
    const lookup = vi.spyOn(svc, 'workspaceForMailbox');
    const countUsed = vi.spyOn(svc, 'cleanupUnitsUsed');
    queryLog.length = 0;

    await db.transaction(async (tx) => {
      await expect(
        svc.assertCleanupCapacityForWorkspace({ workspaceId, tier: 'free' }, 1, tx as never),
      ).resolves.toBeUndefined();
      expect(lookup).not.toHaveBeenCalled();
      expect(countUsed).toHaveBeenCalledWith(workspaceId, tx);
    });
    expect(queryLog.join('\n')).not.toMatch(/for update/i);
    lookup.mockRestore();
    countUsed.mockRestore();
  });

  it('enforces the Action Registry tier per selector without taking away Free single-sender actions', async () => {
    await expect(
      svc.assertActionSelectorTier(mailboxId, 'archive', 'sender'),
    ).resolves.toBeUndefined();

    const err = await svc
      .assertActionSelectorTier(mailboxId, 'archive', 'multi-sender')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('ACTION_TIER_REQUIRED');
    expect((err as AppException).getStatus()).toBe(402);
    expect((err as AppException).details).toEqual({
      tier: 'free',
      requiredTier: 'plus',
      selector: 'multi-sender',
      verb: 'archive',
    });

    const plus = await seedWorkspace(db, 'plus');
    await expect(
      svc.assertActionSelectorTier(plus.mailboxId, 'archive', 'multi-sender'),
    ).resolves.toBeUndefined();
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

  it('locks the workspace tier and checks capacity on the caller transaction', async () => {
    const queryLog: string[] = [];
    db = await freshDb(queryLog);
    svc = new EntitlementsService(db as never);
    const { workspaceId } = await seedWorkspace(db, 'pro');
    queryLog.length = 0;

    await db.transaction(async (tx) => {
      const workspace = await svc.lockInboxWorkspace(workspaceId, tx as never);
      expect(workspace).toEqual({ workspaceId, tier: 'pro' });
      await expect(
        svc.assertInboxCapacityForWorkspace(workspace!, tx as never),
      ).resolves.toBeUndefined();
    });

    expect(queryLog.join('\n')).toMatch(/for update/i);
  });
});

describe('ActionsService free-cap enforcement (end-to-end, D19/D77)', () => {
  let db: Db;
  let workspaceId: string;
  let mailboxId: string;

  beforeEach(async () => {
    db = await freshDb();
    ({ workspaceId, mailboxId } = await seedWorkspace(db, 'free'));
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

  it('multi-sender bulk requires Plus BEFORE quota accounting or writing any row', async () => {
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
    expect((err as AppException).code).toBe('ACTION_TIER_REQUIRED');
    expect((err as AppException).details).toMatchObject({
      tier: 'free',
      requiredTier: 'plus',
      selector: 'multi-sender',
      verb: 'archive',
    });
    const after = await db.select({ id: actionJobs.id }).from(actionJobs);
    expect(after.length).toBe(before.length); // nothing was written
  });

  it('a fresh unsubscribe consumes one Free unit; replay at the cap succeeds; a new intent 402s', async () => {
    const svc = service();
    const sender = await seedSender(db, mailboxId);
    for (let i = 0; i < 4; i++) {
      await seedJob(db, mailboxId, {
        verb: 'archive',
        key: `archive-fill-unsub-${i}`,
        senderId: sender.id,
        senderKey: sender.key,
      });
    }

    const first = await svc.recordUnsubscribeIntent({
      mailboxAccountId: mailboxId,
      senderId: sender.id,
      idempotencyKey: 'free-unsub-fifth',
    });
    expect(await new EntitlementsService(db as never).cleanupSummary(workspaceId)).toMatchObject({
      used: 5,
      remaining: 0,
    });

    // Same Idempotency-Key is a projection of the existing decision,
    // not a sixth cleanup-cap check.
    const replay = await svc.recordUnsubscribeIntent({
      mailboxAccountId: mailboxId,
      senderId: sender.id,
      idempotencyKey: 'free-unsub-fifth',
      // Even a replay that now advertises a backlog action must project
      // the cached decision without a new two-unit capacity check.
      includesBacklogAction: true,
    });
    expect(replay.activityLogId).toBe(first.activityLogId);

    const beforeJobs = await db.select().from(actionJobs);
    const beforeActivity = await db.select().from(activityLog);
    await expect(
      svc.recordUnsubscribeIntent({
        mailboxAccountId: mailboxId,
        senderId: sender.id,
        idempotencyKey: 'free-unsub-sixth',
      }),
    ).rejects.toMatchObject({ code: 'FREE_CAP_REACHED' });
    expect(await db.select().from(actionJobs)).toHaveLength(beforeJobs.length);
    expect(await db.select().from(activityLog)).toHaveLength(beforeActivity.length);
  });

  it('unsubscribe with a backlog action preflights two units and writes nothing when only one remains', async () => {
    const svc = service();
    const sender = await seedSender(db, mailboxId);
    for (let i = 0; i < 4; i++) {
      await seedJob(db, mailboxId, {
        verb: 'archive',
        key: `archive-fill-backlog-${i}`,
        senderId: sender.id,
        senderKey: sender.key,
      });
    }

    await expect(
      svc.recordUnsubscribeIntent({
        mailboxAccountId: mailboxId,
        senderId: sender.id,
        idempotencyKey: 'free-unsub-plus-backlog',
        includesBacklogAction: true,
      }),
    ).rejects.toMatchObject({
      code: 'FREE_CAP_REACHED',
      details: { remaining: 1, requiredUnits: 2 },
    });
    expect(await db.select().from(actionJobs)).toHaveLength(4);
    expect(await db.select().from(activityLog)).toHaveLength(0);
  });
});
