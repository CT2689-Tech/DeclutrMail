import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  actionJobs,
  entitlementGrants,
  mailboxAccounts,
  mailMessages,
  schema,
  senders,
  subscriptions,
  undoJournal,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestPglite } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  METER,
  TIER_IDS,
  TIER_MANIFEST,
  hasCapability,
  inboxLimitReachedMessage,
  passSecondAccountMessage,
  quotaExceededMessage,
  type TierId,
} from '@declutrmail/shared/entitlements';

import { ActionsService } from '../../actions/actions.service.js';
import { AppException } from '../app-exception.js';
import { coerceUsedCount, EntitlementsService } from './entitlements.service.js';

/** Free's monthly email allowance, from the pricing config. */
const FREE_LIMIT = METER.free.limit;

/**
 * EntitlementsService integration tests (D19/D77/D81) — real service
 * against in-process PGlite. Pins Free's emails-cleared meter (the sum
 * of forward `quota_units`, minus same-period undo refunds), the 402
 * gates, and the inbox limit — including the end-to-end leg through
 * `ActionsService` (the over-allowance archive 402s; a replayed key
 * does not).
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

async function seedPassGrant(db: Db, email: string, transactionId: string): Promise<void> {
  await db.insert(entitlementGrants).values({
    email,
    tier: 'plus',
    reason: 'Backlog Pass',
    grantedBy: 'paddle',
    source: 'pass',
    provider: 'paddle',
    providerTransactionId: transactionId,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
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
    quotaUnits?: number;
    createdAt?: Date;
    undoToken?: string;
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
      ...(input.quotaUnits !== undefined ? { quotaUnits: input.quotaUnits } : {}),
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      ...(input.undoToken ? { undoToken: input.undoToken } : {}),
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

describe('EntitlementsService — meter gates (D19/D77)', () => {
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

  it('cleanupSummary: free reports the config limit + remaining + resetsAt; pro is unlimited (no scan)', async () => {
    const sender = await seedSender(db, mailboxId);
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'archive-s1',
      senderId: sender.id,
      senderKey: sender.key,
      quotaUnits: 1,
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
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'archive-fill',
      senderId: sender.id,
      senderKey: sender.key,
      quotaUnits: FREE_LIMIT - 1,
      affectedCount: FREE_LIMIT - 1,
    });
    // limit-1 used, 1 left — one more email fits…
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
      requested: 2,
      suggestedPreset: null,
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

  it('plus: a second inbox is allowed and the third names the Pro waitlist', async () => {
    const { workspaceId, userId } = await seedWorkspace(db, 'plus');
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
    expect((err as AppException).message).toBe(inboxLimitReachedMessage('plus'));
    expect((err as AppException).details).toEqual({ limit: 2, connected: 2, tier: 'plus' });
  });

  it('Pass-only: 402 INBOX_LIMIT_REACHED on a second connect', async () => {
    const { workspaceId } = await seedWorkspace(db, 'plus');
    await seedPassGrant(db, 'o-plus@declutrmail.ai', 'txn-pass-only-second');
    expect(await svc.inboxLimitForWorkspace(workspaceId)).toBe(1);
    expect(await svc.inboxEntitlementForWorkspace(workspaceId)).toEqual({
      limit: 1,
      reason: 'pass',
    });
    const err = await svc.assertCanConnectMailbox(workspaceId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('INBOX_LIMIT_REACHED');
    expect((err as AppException).getStatus()).toBe(402);
    expect((err as AppException).message).toBe(passSecondAccountMessage());
    expect((err as AppException).details).toEqual({
      limit: 1,
      connected: 1,
      tier: 'plus',
      reason: 'pass',
    });
    await expect(db.select({ id: mailboxAccounts.id }).from(mailboxAccounts)).resolves.toHaveLength(
      1,
    );
  });

  it('Pass-only: an existing two-account workspace keeps both and only blocks a third', async () => {
    const { workspaceId, userId, mailboxId } = await seedWorkspace(db, 'plus');
    await seedPassGrant(db, 'o-plus@declutrmail.ai', 'txn-pass-only-keep');
    const [second] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId,
        userId,
        provider: 'gmail',
        providerAccountId: 'pass-second@x',
      })
      .returning({ id: mailboxAccounts.id });
    expect(await svc.inboxLimitForWorkspace(workspaceId)).toBe(1);
    const err = await svc.assertCanConnectMailbox(workspaceId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('INBOX_LIMIT_REACHED');
    expect((err as AppException).details).toEqual({
      limit: 1,
      connected: 2,
      tier: 'plus',
      reason: 'pass',
    });
    const remaining = await db
      .select({ id: mailboxAccounts.id, status: mailboxAccounts.status })
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.workspaceId, workspaceId));
    expect(remaining).toEqual(
      expect.arrayContaining([
        { id: mailboxId, status: 'active' },
        { id: second!.id, status: 'active' },
      ]),
    );
    expect(remaining).toHaveLength(2);
  });

  it('expired Pass with stale workspaces.tier plus uses the Free inbox ceiling', async () => {
    const { workspaceId } = await seedWorkspace(db, 'plus');
    await db.insert(entitlementGrants).values({
      email: 'o-plus@declutrmail.ai',
      tier: 'plus',
      reason: 'Backlog Pass',
      grantedBy: 'paddle',
      source: 'pass',
      provider: 'paddle',
      providerTransactionId: 'txn-pass-expired-ceiling',
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(await svc.inboxLimitForWorkspace(workspaceId)).toBe(1);
    expect(await svc.inboxEntitlementForWorkspace(workspaceId)).toEqual({ limit: 1 });
    const err = await svc.assertCanConnectMailbox(workspaceId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('INBOX_LIMIT_REACHED');
    expect((err as AppException).message).toBe(inboxLimitReachedMessage('free'));
    expect((err as AppException).details).toEqual({ limit: 1, connected: 1, tier: 'plus' });
  });

  it('Pass plus a granting paid Plus subscription keeps the Plus inbox floor', async () => {
    const { workspaceId } = await seedWorkspace(db, 'plus');
    await seedPassGrant(db, 'o-plus@declutrmail.ai', 'txn-pass-plus-paid');
    await db.insert(subscriptions).values({
      workspaceId,
      provider: 'paddle',
      providerSubscriptionId: 'sub-pass-plus-paid',
      tier: 'plus',
      status: 'active',
      providerPriceId: 'pri_plus',
      billingCycle: 'annual',
    });
    expect(await svc.inboxLimitForWorkspace(workspaceId)).toBe(2);
    await expect(svc.assertCanConnectMailbox(workspaceId)).resolves.toBeUndefined();
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

  it('the over-allowance archive 402s with the FREE_CAP_REACHED envelope; replay of a spent key does not', async () => {
    const svc = service();
    const filler = await seedSender(db, mailboxId);
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'archive-fill',
      senderId: filler.id,
      senderKey: filler.key,
      quotaUnits: FREE_LIMIT - 1,
      affectedCount: FREE_LIMIT - 1,
    });
    // One email left — a one-email archive fits and spends it.
    const last = await seedSender(db, mailboxId);
    await seedInboxMessage(db, mailboxId, last.key, 'm-last');
    const spent = await svc.enqueueComposite({
      mailboxAccountId: mailboxId,
      selector: { type: 'sender', senderId: last.id },
      primary: { type: 'archive', olderThanDays: null },
      idempotencyKey: 'click-last',
      override: false,
    });
    // The first over-allowance fresh enqueue is denied…
    const overQuota = await seedSender(db, mailboxId);
    await seedInboxMessage(db, mailboxId, overQuota.key, 'm-over');
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
      requested: 1,
    });

    // …but a network-retried click of the spending archive replays, never 402s.
    const replay = await svc.enqueueComposite({
      mailboxAccountId: mailboxId,
      selector: { type: 'sender', senderId: last.id },
      primary: { type: 'archive', olderThanDays: null },
      idempotencyKey: 'click-last',
      override: false,
    });
    expect(replay.actionId).toBe(spent.actionId);
  });

  it('keep-intent stays exempt at the cap (policy write, never gated)', async () => {
    const svc = service();
    const sender = await seedSender(db, mailboxId);
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'archive-fill',
      senderId: sender.id,
      senderKey: sender.key,
      quotaUnits: FREE_LIMIT,
      affectedCount: FREE_LIMIT,
    });
    const keep = await svc.recordKeepIntent({ mailboxAccountId: mailboxId, senderId: sender.id });
    expect(keep.activityLogId).toBeTruthy();
  });

  it('A3: Free bulk is metered — a bulk that fits spends its emails; one that does not fit 402s atomically', async () => {
    const svc = service();
    const filler = await seedSender(db, mailboxId);
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'archive-fill',
      senderId: filler.id,
      senderKey: filler.key,
      quotaUnits: FREE_LIMIT - 3,
      affectedCount: FREE_LIMIT - 3,
    });
    const s1 = await seedSender(db, mailboxId);
    const s2 = await seedSender(db, mailboxId);
    await seedInboxMessage(db, mailboxId, s1.key, 'b1');
    await seedInboxMessage(db, mailboxId, s2.key, 'b2');

    // 3 emails left — a bulk clearing 2 fits and spends exactly 2.
    const ok = await svc.enqueueBulkComposite({
      mailboxAccountId: mailboxId,
      senderIds: [s1.id, s2.id],
      primary: { type: 'archive', olderThanDays: null },
      idempotencyKey: 'bulk-click-fits',
    });
    expect(ok.senderCount).toBe(2);
    const summary = await new EntitlementsService(db as never).cleanupSummary(workspaceId);
    expect(summary).toMatchObject({ used: FREE_LIMIT - 1, remaining: 1 });

    // 1 email left — a bulk clearing 2 must NOT fit, and must write
    // NOTHING (the capacity check and the inserts share one transaction).
    const s3 = await seedSender(db, mailboxId);
    const s4 = await seedSender(db, mailboxId);
    await seedInboxMessage(db, mailboxId, s3.key, 'b3');
    await seedInboxMessage(db, mailboxId, s4.key, 'b4');
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

  it('unsubscribe draws nothing from a spent allowance; a replay projects the same decision', async () => {
    const svc = service();
    const sender = await seedSender(db, mailboxId);
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'archive-fill-unsub',
      senderId: sender.id,
      senderKey: sender.key,
      quotaUnits: FREE_LIMIT,
      affectedCount: FREE_LIMIT,
    });

    const first = await svc.recordUnsubscribeIntent({
      mailboxAccountId: mailboxId,
      senderId: sender.id,
      idempotencyKey: 'free-unsub-at-cap',
    });
    expect(await new EntitlementsService(db as never).cleanupSummary(workspaceId)).toMatchObject({
      used: FREE_LIMIT,
      remaining: 0,
    });

    const replay = await svc.recordUnsubscribeIntent({
      mailboxAccountId: mailboxId,
      senderId: sender.id,
      idempotencyKey: 'free-unsub-at-cap',
    });
    expect(replay.activityLogId).toBe(first.activityLogId);
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

describe('Free emails-cleared meter', () => {
  let db: Db;
  let workspaceId: string;
  let mailboxId: string;
  let svc: EntitlementsService;

  beforeEach(async () => {
    db = await freshDb();
    ({ workspaceId, mailboxId } = await seedWorkspace(db, 'free'));
    svc = new EntitlementsService(db as never);
  });

  async function issueUndo(actionKind: 'archive' | 'later' = 'archive'): Promise<string> {
    const [row] = await db
      .insert(undoJournal)
      .values({
        mailboxAccountId: mailboxId,
        actionKind,
        payload: { messageIds: [] },
      })
      .returning({ token: undoJournal.token });
    return row!.token;
  }

  it('sums stamped emails, and a same-period undo refunds restored emails', async () => {
    const sender = await seedSender(db, mailboxId);
    const token = await issueUndo();
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'charged',
      senderId: sender.id,
      senderKey: sender.key,
      quotaUnits: 100,
      affectedCount: 100,
      undoToken: token,
    });
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'undo',
      senderId: sender.id,
      senderKey: sender.key,
      direction: 'reverse',
      affectedCount: 40,
      quotaUnits: 0,
      undoToken: token,
    });
    expect(await svc.cleanupUnitsUsed(workspaceId)).toBe(60);
  });

  it('does not refund unrelated Archive usage when free Later is undone', async () => {
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'charged-archive',
      quotaUnits: 900,
      affectedCount: 900,
    });
    const token = await issueUndo('later');
    await seedJob(db, mailboxId, {
      verb: 'later',
      key: 'free-later',
      quotaUnits: 0,
      affectedCount: 100,
      undoToken: token,
    });
    await seedJob(db, mailboxId, {
      verb: 'later',
      key: 'undo-free-later',
      direction: 'reverse',
      quotaUnits: 0,
      affectedCount: 100,
      undoToken: token,
    });

    expect(await svc.cleanupSummary(workspaceId)).toMatchObject({
      used: 900,
      remaining: METER.free.limit - 900,
    });
    await expect(svc.assertCleanupCapacity(mailboxId, 101)).rejects.toMatchObject({
      code: 'FREE_CAP_REACHED',
    });
  });

  it('never refunds more than the forward charge when more emails were restored', async () => {
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'unrelated-archive',
      quotaUnits: 900,
      affectedCount: 900,
    });
    const token = await issueUndo();
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'settled-at-reservation',
      quotaUnits: 40,
      affectedCount: 100,
      undoToken: token,
    });
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'undo-reservation',
      direction: 'reverse',
      affectedCount: 100,
      quotaUnits: 0,
      undoToken: token,
    });

    expect(await svc.cleanupSummary(workspaceId)).toMatchObject({
      used: 900,
      remaining: METER.free.limit - 900,
    });
  });

  it('does not refund an undo whose forward row is in an earlier period', async () => {
    const now = new Date();
    const anchor = new Date(now.getTime());
    anchor.setUTCMonth(anchor.getUTCMonth() - 2);
    anchor.setTime(anchor.getTime() - 60 * 60 * 1000);
    await db.update(workspaces).set({ createdAt: anchor }).where(eq(workspaces.id, workspaceId));
    const sender = await seedSender(db, mailboxId);
    const oldToken = await issueUndo();
    await seedJob(db, mailboxId, {
      verb: 'delete',
      key: 'old-period',
      senderId: sender.id,
      senderKey: sender.key,
      quotaUnits: 200,
      affectedCount: 200,
      createdAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000),
      undoToken: oldToken,
    });
    await seedJob(db, mailboxId, {
      verb: 'delete',
      key: 'old-undo',
      direction: 'reverse',
      affectedCount: 200,
      undoToken: oldToken,
    });
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'this-period',
      senderId: sender.id,
      senderKey: sender.key,
      quotaUnits: 50,
      affectedCount: 50,
    });
    expect(await svc.cleanupUnitsUsed(workspaceId)).toBe(50);
  });

  it('counts a partial completion at the settled stamp, and free verbs at 0', async () => {
    const sender = await seedSender(db, mailboxId);
    await seedJob(db, mailboxId, {
      verb: 'delete',
      key: 'partial',
      senderId: sender.id,
      senderKey: sender.key,
      quotaUnits: 40,
      affectedCount: 40,
    });
    await seedJob(db, mailboxId, {
      verb: 'unsubscribe',
      key: 'unsub:partial',
      senderId: sender.id,
      senderKey: sender.key,
      quotaUnits: 0,
      affectedCount: 0,
    });
    await seedJob(db, mailboxId, {
      verb: 'later',
      key: 'later-partial',
      senderId: sender.id,
      senderKey: sender.key,
      quotaUnits: 0,
    });
    expect(await svc.cleanupUnitsUsed(workspaceId)).toBe(40);
  });

  it('does not meter Plus', async () => {
    const plus = await seedWorkspace(db, 'plus');
    const plusSvc = new EntitlementsService(db as never);
    await expect(plusSvc.assertCleanupCapacity(plus.mailboxId, 5_000)).resolves.toBeUndefined();
    const summary = await plusSvc.cleanupSummary(plus.workspaceId);
    expect(summary.limit).toBeNull();
  });

  it('402s a 2,708 delete at 900 used and then allows the fitting preset', async () => {
    const sender = await seedSender(db, mailboxId);
    await seedJob(db, mailboxId, {
      verb: 'archive',
      key: 'used-900',
      senderId: sender.id,
      senderKey: sender.key,
      quotaUnits: 900,
      affectedCount: 900,
    });
    const [ws] = await db
      .select({ createdAt: workspaces.createdAt })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    const workspace = { workspaceId, tier: 'free' as const, createdAt: ws!.createdAt };
    const err = await svc
      .assertCleanupCapacityForWorkspace(workspace, 2708, db, {
        30: 80,
        90: 400,
        180: 1_200,
        365: 2_708,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    const hit = err as AppException;
    expect(hit.code).toBe('FREE_CAP_REACHED');
    expect(hit.details).toMatchObject({
      limit: METER.free.limit,
      used: 900,
      remaining: METER.free.limit - 900,
      requested: 2708,
      suggestedPreset: 30,
    });
    expect(hit.message).toBe(
      quotaExceededMessage({
        used: 900,
        limit: METER.free.limit,
        resetAt: String(hit.details?.resetsAt),
        requested: 2708,
      }),
    );
    await expect(svc.assertCleanupCapacityForWorkspace(workspace, 80, db)).resolves.toBeUndefined();
  });
});
