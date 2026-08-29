import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
import { freshTestPglite } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TIER_IDS,
  TIER_MANIFEST,
  hasCapability,
  type TierId,
} from '@declutrmail/shared/entitlements';

import { ActionsService } from '../../actions/actions.service.js';
import { AppException } from '../app-exception.js';
import { coerceUsedCount, EntitlementsService } from './entitlements.service.js';

/** The Free monthly quota, from the pricing config (A3). */
const FREE_LIMIT = TIER_MANIFEST.free.cleanupActionsPerMonth!;

/**
 * EntitlementsService integration tests (D19/D77/D81) — real service
 * against in-process PGlite. Pins the COUNTING RULE (one cleanup unit
 * per sender per enqueue; composites = 1; bulk of N = N; intents +
 * reverses + failures exempt; undo never refunds), the 402 gates, and
 * the inbox limit — including the end-to-end leg through
 * `ActionsService` (the 6th cleanup action 402s; a replayed key does
 * not).
 */

type Db = ReturnType<typeof drizzle<typeof schema>>;

async function freshDb(queryLog?: string[]): Promise<Db> {
  const pg = await freshTestPglite();
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
    rootActionId?: string;
    retryOfActionId?: string;
    recoveryAttempt?: number;
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
      ...(input.verb === 'later' ? { wakeAt: new Date('2099-07-21T09:00:00Z') } : {}),
      ...(input.compositeId ? { compositeId: input.compositeId } : {}),
      ...(input.rootActionId
        ? {
            rootActionId: input.rootActionId,
            retryOfActionId: input.retryOfActionId,
            recoveryAttempt: input.recoveryAttempt,
            selectionFrozenAt: new Date('2026-05-02T00:00:00Z'),
          }
        : {}),
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

describe('coerceUsedCount — the ::int cast is not load-bearing (QA-triage-20260827-04)', () => {
  // postgres.js has no default parser for a bare bigint (OID 20); the
  // real query fragment ends in `::int` today, so `used` never actually
  // arrives as a string in production. This test proves the DEFENSIVE
  // coercion works on its own terms — independent of whether the cast
  // stays in the query — by feeding the exact shape a dropped cast
  // would hand back.
  it('coerces a string count (what a dropped ::int cast would decode to)', () => {
    expect(coerceUsedCount('5')).toBe(5);
    expect(typeof coerceUsedCount('5')).toBe('number');
  });

  it('passes a real number through unchanged', () => {
    expect(coerceUsedCount(5)).toBe(5);
  });

  it('defaults a missing row to 0', () => {
    expect(coerceUsedCount(undefined)).toBe(0);
    expect(coerceUsedCount(null)).toBe(0);
  });
});

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

  it('a recovery attempt shares the failed original lineage and consumes ONE unit', async () => {
    const sender = await seedSender(db, mailboxId);
    const failedId = await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'archive-failed-for-recovery',
      senderId: sender.id,
      senderKey: sender.key,
      status: 'failed',
    });
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'recovery-click-1',
      senderId: sender.id,
      senderKey: sender.key,
      rootActionId: failedId,
      retryOfActionId: failedId,
      recoveryAttempt: 1,
      status: 'queued',
      affectedCount: 0,
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

  it('cleanupSummary: free reports the config limit + remaining + resetsAt; pro is unlimited (no scan)', async () => {
    const sender = await seedSender(db, mailboxId);
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'archive-s1',
      senderId: sender.id,
      senderKey: sender.key,
    });
    expect(await svc.cleanupSummary(workspaceId)).toEqual({
      tier: 'free',
      limit: FREE_LIMIT,
      used: 1,
      remaining: FREE_LIMIT - 1,
      resetsAt: expect.any(Date),
    });

    const pro = await seedWorkspace(db, 'pro');
    expect(await svc.cleanupSummary(pro.workspaceId)).toEqual({
      tier: 'pro',
      limit: null,
      used: 0,
      remaining: null,
      resetsAt: null,
    });
  });

  it('assertCleanupCapacity: 402 FREE_CAP_REACHED with details at the cap; passes under it', async () => {
    const sender = await seedSender(db, mailboxId);
    for (let i = 0; i < FREE_LIMIT - 1; i++) {
      await seedJob(db, mailboxId, {
        verb: 'archive',
        key: `archive-fill-${i}`,
        senderId: sender.id,
        senderKey: sender.key,
      });
    }
    // limit-1 used, 1 left — one more unit fits…
    await expect(svc.assertCleanupCapacity(mailboxId, 1)).resolves.toBeUndefined();
    // …but a bulk needing 2 does not (the mid-selection 402).
    const err = await svc.assertCleanupCapacity(mailboxId, 2).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('FREE_CAP_REACHED');
    expect((err as AppException).getStatus()).toBe(402);
    expect((err as AppException).details).toEqual({
      remaining: 1,
      limit: FREE_LIMIT,
      used: FREE_LIMIT - 1,
      requiredUnits: 2,
      resetsAt: expect.any(String),
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
      createdAt: expect.any(Date),
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
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    queryLog.length = 0;

    await expect(svc.lockCleanupWorkspace(plus.mailboxId)).resolves.toEqual({
      workspaceId: plus.workspaceId,
      tier: 'plus',
      createdAt: expect.any(Date),
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
      expect(countUsed).toHaveBeenCalledWith(workspaceId, tx, expect.any(Date));
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
        svc.assertCleanupCapacityForWorkspace(
          { workspaceId, tier: 'free', createdAt: new Date('2026-01-01T00:00:00.000Z') },
          1,
          tx as never,
        ),
      ).resolves.toBeUndefined();
      expect(lookup).not.toHaveBeenCalled();
      expect(countUsed).toHaveBeenCalledWith(workspaceId, tx, expect.any(Date));
    });
    expect(queryLog.join('\n')).not.toMatch(/for update/i);
    lookup.mockRestore();
    countUsed.mockRestore();
  });

  it('enforces the Action Registry tier per selector — A3: bulk is Free, all-matching stays Pro', async () => {
    await expect(
      svc.assertActionSelectorTier(mailboxId, 'archive', 'sender'),
    ).resolves.toBeUndefined();
    await expect(
      svc.assertActionSelectorTier(mailboxId, 'archive', 'multi-sender'),
    ).resolves.toBeUndefined();

    const err = await svc
      .assertActionSelectorTier(mailboxId, 'archive', 'sender-filter')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('ACTION_TIER_REQUIRED');
    expect((err as AppException).getStatus()).toBe(402);
    expect((err as AppException).details).toEqual({
      tier: 'free',
      requiredTier: 'pro',
      selector: 'sender-filter',
      verb: 'archive',
    });

    const pro = await seedWorkspace(db, 'pro');
    await expect(
      svc.assertActionSelectorTier(pro.mailboxId, 'archive', 'sender-filter'),
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

  it('pro: allows connections up to the manifest limit, blocks the next', async () => {
    // Derived from the manifest ON PURPOSE, unlike the capability
    // ladders in capability.guard.spec.ts. Those assert WHICH tier owns
    // a surface, so they must restate it by hand. This asserts that the
    // ENFORCEMENT honours whatever number is configured — the limit is
    // this test's input, not its claim, so re-tiering inboxes must not
    // require editing it.
    const limit = TIER_MANIFEST.pro.inboxLimit;
    const { workspaceId, userId } = await seedWorkspace(db, 'pro');

    // seedWorkspace already connected one mailbox.
    for (let n = 2; n <= limit; n += 1) {
      await expect(svc.assertCanConnectMailbox(workspaceId), `slot ${n}`).resolves.toBeUndefined();
      await db.insert(mailboxAccounts).values({
        workspaceId,
        userId,
        provider: 'gmail',
        providerAccountId: `mailbox-${n}@x`,
      });
    }

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

  it('the over-quota cleanup action 402s with the FREE_CAP_REACHED envelope; replay of a spent key does not', async () => {
    const svc = service();
    // Fresh single-sender composites — exactly the monthly quota.
    for (let i = 0; i < FREE_LIMIT; i++) {
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
    // The first over-quota fresh enqueue is denied…
    const overQuota = await seedSender(db, mailboxId);
    const err = await svc
      .enqueueComposite({
        mailboxAccountId: mailboxId,
        selector: { type: 'sender', senderId: overQuota.id },
        primary: { type: 'archive', olderThanDays: null },
        idempotencyKey: 'click-over',
        override: false,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('FREE_CAP_REACHED');
    expect((err as AppException).getStatus()).toBe(402);
    expect((err as AppException).details).toMatchObject({
      remaining: 0,
      limit: FREE_LIMIT,
      used: FREE_LIMIT,
    });

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
    for (let i = 0; i < FREE_LIMIT; i++) {
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

  it('A3: Free bulk is metered — a bulk that fits consumes N units; one that does not fit 402s atomically', async () => {
    const svc = service();
    const filler = await seedSender(db, mailboxId);
    for (let i = 0; i < FREE_LIMIT - 3; i++) {
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

    // 3 units left — a bulk of 2 fits and consumes exactly 2.
    const ok = await svc.enqueueBulkComposite({
      mailboxAccountId: mailboxId,
      senderIds: [s1.id, s2.id],
      primary: { type: 'archive', olderThanDays: null },
      idempotencyKey: 'bulk-click-fits',
    });
    expect(ok.senderCount).toBe(2);
    const summary = await new EntitlementsService(db as never).cleanupSummary(workspaceId);
    expect(summary).toMatchObject({ used: FREE_LIMIT - 1, remaining: 1 });

    // 1 unit left — a bulk of 2 must NOT fit, and must write NOTHING
    // (the capacity check and the inserts share one transaction).
    const s3 = await seedSender(db, mailboxId);
    const s4 = await seedSender(db, mailboxId);
    const before = await db.select({ id: actionJobs.id }).from(actionJobs);
    await expect(
      svc.enqueueBulkComposite({
        mailboxAccountId: mailboxId,
        senderIds: [s3.id, s4.id],
        primary: { type: 'archive', olderThanDays: null },
        idempotencyKey: 'bulk-click-overflow',
      }),
    ).rejects.toMatchObject({
      code: 'FREE_CAP_REACHED',
      details: { remaining: 1, requiredUnits: 2 },
    });
    const after = await db.select({ id: actionJobs.id }).from(actionJobs);
    expect(after.length).toBe(before.length); // nothing was written
  });

  it('a fresh unsubscribe consumes one Free unit; replay at the cap succeeds; a new intent 402s', async () => {
    const svc = service();
    const sender = await seedSender(db, mailboxId);
    for (let i = 0; i < FREE_LIMIT - 1; i++) {
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
      used: FREE_LIMIT,
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
    for (let i = 0; i < FREE_LIMIT - 1; i++) {
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
    expect(await db.select().from(actionJobs)).toHaveLength(FREE_LIMIT - 1);
    expect(await db.select().from(activityLog)).toHaveLength(0);
  });
});

describe('migration 0074 — purge of unentitled Brief / Follow-ups rows', () => {
  /**
   * `packages/db` depends on no workspace package, so migration SQL
   * cannot read `TIER_MANIFEST` and 0074 names its tiers as literals.
   * A literal tier list is exactly the shape that produced the drift
   * PR #621 spent a day unwinding, so it is checked rather than trusted:
   * this test reads the migration and compares it to the tiers that
   * actually hold each capability.
   *
   * If `brief` or `followups` is ever re-tiered, this fails and names
   * the migration as stale — which is the correct outcome. A shipped
   * one-time purge cannot be edited after the fact; the fix is a NEW
   * migration for the newly-unentitled tiers, and this failure is where
   * someone finds that out.
   */
  const MIGRATION = readFileSync(
    join(
      import.meta.dirname,
      '..',
      '..',
      '..',
      '..',
      '..',
      'packages',
      'db',
      'migrations',
      '0074_purge_unentitled_brief_and_followup_rows.sql',
    ),
    'utf8',
  );

  function purgedTiersFor(table: string): TierId[] {
    // The DELETE keeps rows for the tiers listed in NOT IN (...), so the
    // PURGED set is every tier absent from that list.
    const stmt = MIGRATION.split('--> statement-breakpoint').find((chunk) =>
      chunk.includes(`DELETE FROM "${table}"`),
    );
    expect(stmt, `0074 has no DELETE for ${table}`).toBeDefined();
    const kept = [...stmt!.matchAll(/'([a-z]+)'/g)].map((m) => m[1]!);
    return TIER_IDS.filter((id) => !kept.includes(id));
  }

  it.each([['brief_runs', 'brief'] as const, ['followup_tracker', 'followups'] as const])(
    'purges %s for exactly the tiers without %s',
    (table, capability) => {
      const shouldPurge = TIER_IDS.filter((id) => !hasCapability(id, capability));
      expect(purgedTiersFor(table).sort()).toEqual([...shouldPurge].sort());
    },
  );

  it('never purges a tier that holds the capability', () => {
    // The direction that matters: an over-broad list would delete an
    // entitled workspace's real Brief history, not just leftovers.
    for (const [table, capability] of [
      ['brief_runs', 'brief'],
      ['followup_tracker', 'followups'],
    ] as const) {
      for (const tierId of purgedTiersFor(table)) {
        expect(
          hasCapability(tierId, capability),
          `0074 would delete ${table} rows for ${tierId}, which HAS ${capability}`,
        ).toBe(false);
      }
    }
  });
});
