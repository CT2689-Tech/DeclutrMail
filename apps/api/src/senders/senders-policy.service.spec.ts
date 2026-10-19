import {
  activityLog,
  mailboxAccounts,
  schema,
  senderPolicies,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { ActionsService } from '../actions/actions.service.js';
import { SendersPolicyService } from './senders-policy.service.js';

/**
 * SendersPolicyService integration tests (D40, D42, D43).
 *
 * Real service against in-process PGlite with every migration applied —
 * covers the two standing-policy mutations (Keep / Protect):
 * upsert semantics, the D43 audit rows, set-state idempotency (a
 * repeat patch is a no-op with no phantom audit row), the D22
 * protection provenance + user-agency memory pin, tenant ownership,
 * and the capability round-trip (a freshly Protected sender gates the
 * destructive Archive enqueue with 409 PROTECTED_SENDER).
 */

type Db = ReturnType<typeof drizzle<typeof schema>>;

const SENDER_KEY = 'c'.repeat(64);

async function freshDb(): Promise<Db> {
  return freshTestDb();
}

async function seedMailbox(db: Db, label = 'o'): Promise<string> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS-${label}` })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: `${label}@declutrmail.ai` })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: `${label}@x`,
    })
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

async function policyRow(db: Db, mailboxAccountId: string) {
  const [row] = await db
    .select()
    .from(senderPolicies)
    .where(
      and(
        eq(senderPolicies.mailboxAccountId, mailboxAccountId),
        eq(senderPolicies.senderKey, SENDER_KEY),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function auditRows(db: Db, mailboxAccountId: string) {
  return await db
    .select({
      action: activityLog.action,
      source: activityLog.source,
      affectedCount: activityLog.affectedCount,
      undoToken: activityLog.undoToken,
      senderKey: activityLog.senderKey,
    })
    .from(activityLog)
    .where(eq(activityLog.mailboxAccountId, mailboxAccountId));
}

describe('SendersPolicyService', () => {
  let db: Db;
  let mailboxId: string;
  let senderId: string;
  let svc: SendersPolicyService;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db);
    senderId = await seedSender(db, mailboxId);
    svc = new SendersPolicyService(db as never);
  });

  describe('keep (D40)', () => {
    it('creates the policy row with policy_type=keep + a keep audit row', async () => {
      const res = await svc.setPolicy({
        mailboxAccountId: mailboxId,
        senderId,
        patch: { policyType: 'keep' },
      });

      expect(res).toMatchObject({
        senderId,
        policyType: 'keep',
        isProtected: false,
        changed: true,
      });

      const row = await policyRow(db, mailboxId);
      expect(row).toMatchObject({ policyType: 'keep', isProtected: false });

      const audit = await auditRows(db, mailboxId);
      expect(audit).toEqual([
        {
          action: 'keep',
          source: 'manual',
          affectedCount: 0,
          undoToken: null,
          senderKey: SENDER_KEY,
        },
      ]);
    });

    it('overwrites a standing unsubscribe verdict (latest decision wins)', async () => {
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY,
        policyType: 'unsubscribe',
      });

      const res = await svc.setPolicy({
        mailboxAccountId: mailboxId,
        senderId,
        patch: { policyType: 'keep' },
      });

      expect(res.policyType).toBe('keep');
      expect(res.changed).toBe(true);
      const row = await policyRow(db, mailboxId);
      expect(row!.policyType).toBe('keep');
    });

    it('is idempotent — a repeat keep writes no second audit row', async () => {
      await svc.setPolicy({ mailboxAccountId: mailboxId, senderId, patch: { policyType: 'keep' } });
      const replay = await svc.setPolicy({
        mailboxAccountId: mailboxId,
        senderId,
        patch: { policyType: 'keep' },
      });

      expect(replay.changed).toBe(false);
      expect(replay.policyType).toBe('keep');
      const audit = await auditRows(db, mailboxId);
      expect(audit).toHaveLength(1);
    });
  });

  describe('undo keep', () => {
    it('clears the standing Keep decision and reverts the keep audit row', async () => {
      await svc.setPolicy({ mailboxAccountId: mailboxId, senderId, patch: { policyType: 'keep' } });
      const res = await svc.undoKeep({ mailboxAccountId: mailboxId, senderId });
      expect(res).toMatchObject({ policyType: null, changed: true, isProtected: false });
      expect((await policyRow(db, mailboxId))!.policyType).toBeNull();
      const [audit] = await db
        .select()
        .from(activityLog)
        .where(eq(activityLog.mailboxAccountId, mailboxId));
      expect(audit!.action).toBe('keep');
      expect(audit!.revertedAt).not.toBeNull();
    });

    it.each([false, true])(
      'reverts a pending Keep audit without losing timer metadata (timer=%s)',
      async (timer) => {
        if (timer)
          await db.insert(senderPolicies).values({
            mailboxAccountId: mailboxId,
            senderKey: SENDER_KEY,
            policyType: null,
            snoozedUntil: new Date('2099-01-01T09:00:00Z'),
            snoozedAt: new Date('2026-10-15T09:00:00Z'),
          });
        await db.insert(activityLog).values({
          mailboxAccountId: mailboxId,
          senderKey: SENDER_KEY,
          source: 'manual',
          action: 'keep',
          affectedCount: 0,
          undoToken: null,
        });
        const res = await svc.undoKeep({ mailboxAccountId: mailboxId, senderId });
        expect(res.changed).toBe(true);
        const row = await policyRow(db, mailboxId);
        if (timer) {
          expect(row!.policyType).toBeNull();
          expect(row!.snoozedUntil!.toISOString()).toBe('2099-01-01T09:00:00.000Z');
        } else expect(row).toBeNull();
        const [audit] = await db
          .select()
          .from(activityLog)
          .where(eq(activityLog.mailboxAccountId, mailboxId));
        expect(audit!.revertedAt).not.toBeNull();
      },
    );

    it('Undo Keep preserves a Later timer, note and recovery state', async () => {
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY,
        policyType: null,
        snoozedUntil: new Date('2099-01-01T09:00:00Z'),
        snoozedAt: new Date('2026-10-15T09:00:00Z'),
        snoozedReason: 'after launch',
        snoozeWakeFailureCount: 1,
        snoozeWakeLastAttemptAt: new Date('2026-10-15T09:01:00Z'),
        snoozeWakeLastFailedAt: new Date('2026-10-15T09:01:00Z'),
        snoozeWakeFailureKind: 'temporary',
      });
      await svc.setPolicy({ mailboxAccountId: mailboxId, senderId, patch: { policyType: 'keep' } });
      const before = await policyRow(db, mailboxId);
      const result = await svc.undoKeep({ mailboxAccountId: mailboxId, senderId });
      expect(result).toMatchObject({ policyType: null, changed: true });
      const after = await policyRow(db, mailboxId);
      expect(after).toMatchObject({
        policyType: null,
        snoozedUntil: before!.snoozedUntil,
        snoozedAt: before!.snoozedAt,
        snoozedReason: 'after launch',
        snoozeWakeFailureCount: 1,
        snoozeWakeLastFailedAt: before!.snoozeWakeLastFailedAt,
        snoozeWakeFailureKind: 'temporary',
      });
      expect((await svc.undoKeep({ mailboxAccountId: mailboxId, senderId })).changed).toBe(false);
    });

    it('maps a mailbox lock timeout to a retryable conflict and leaves Keep in place', async () => {
      await svc.setPolicy({ mailboxAccountId: mailboxId, senderId, patch: { policyType: 'keep' } });
      const timeout = Object.assign(new Error('Failed query: select pg_advisory_xact_lock'), {
        cause: Object.assign(new Error('canceling statement due to lock timeout'), {
          code: '55P03',
        }),
      });
      const busyDb = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop === 'transaction') return async () => Promise.reject(timeout);
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const busy = new SendersPolicyService(busyDb as never);
      await expect(busy.undoKeep({ mailboxAccountId: mailboxId, senderId })).rejects.toMatchObject({
        code: 'ACTION_STILL_RUNNING',
        retryable: true,
        status: 409,
      });
      expect((await policyRow(db, mailboxId))!.policyType).toBe('keep');
      const [audit] = await db
        .select({ revertedAt: activityLog.revertedAt })
        .from(activityLog)
        .where(eq(activityLog.mailboxAccountId, mailboxId));
      expect(audit!.revertedAt).toBeNull();
    });

    it('refuses to undo a protected keep', async () => {
      await svc.setPolicy({
        mailboxAccountId: mailboxId,
        senderId,
        patch: { policyType: 'keep', isProtected: true },
      });
      await expect(svc.undoKeep({ mailboxAccountId: mailboxId, senderId })).rejects.toMatchObject({
        status: 409,
      });
      expect(await policyRow(db, mailboxId)).not.toBeNull();
    });
  });

  describe('Protect toggle (D42, D43, D22)', () => {
    it('protects with user_defined provenance + protection_set_at + audit row', async () => {
      const res = await svc.setPolicy({
        mailboxAccountId: mailboxId,
        senderId,
        patch: { isProtected: true },
      });

      expect(res).toMatchObject({
        isProtected: true,
        protectionReason: 'user_defined',
        changed: true,
      });
      expect(res.protectionSetAt).not.toBeNull();

      const audit = await auditRows(db, mailboxId);
      expect(audit.map((a) => a.action)).toEqual(['marked_protected']);
    });

    it('unprotect clears protection_set_at but PINS the prior reason (user-agency memory pin)', async () => {
      // Seed the engagement auto-protect shape the sync workers write.
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY,
        policyType: 'keep',
        isProtected: true,
        protectionReason: 'replied',
        protectionSetAt: new Date('2026-05-01'),
      });

      const res = await svc.setPolicy({
        mailboxAccountId: mailboxId,
        senderId,
        patch: { isProtected: false },
      });

      expect(res.isProtected).toBe(false);
      expect(res.protectionSetAt).toBeNull();
      // The pin: reason survives the demote so the sync workers'
      // re-protect guard (non-null reason memory pin) skips this
      // row instead of silently re-protecting on the next sync.
      expect(res.protectionReason).toBe('replied');

      const audit = await auditRows(db, mailboxId);
      expect(audit.map((a) => a.action)).toEqual(['unmarked_protected']);
    });

    it('manual re-protect of a demoted engagement row upgrades provenance to user_defined', async () => {
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY,
        policyType: 'keep',
        isProtected: false,
        protectionReason: 'replied',
      });

      const res = await svc.setPolicy({
        mailboxAccountId: mailboxId,
        senderId,
        patch: { isProtected: true },
      });

      expect(res).toMatchObject({ isProtected: true, protectionReason: 'user_defined' });
    });

    it('is idempotent — repeating the same protect state writes no second audit row', async () => {
      await svc.setPolicy({ mailboxAccountId: mailboxId, senderId, patch: { isProtected: true } });
      const replay = await svc.setPolicy({
        mailboxAccountId: mailboxId,
        senderId,
        patch: { isProtected: true },
      });

      expect(replay.changed).toBe(false);
      expect(await auditRows(db, mailboxId)).toHaveLength(1);
    });
  });

  describe('combined patch', () => {
    it('applies multiple fields in one call with one audit row per change', async () => {
      const res = await svc.setPolicy({
        mailboxAccountId: mailboxId,
        senderId,
        patch: { policyType: 'keep', isProtected: true },
      });

      expect(res).toMatchObject({
        policyType: 'keep',
        isProtected: true,
        protectionReason: 'user_defined',
        changed: true,
      });

      const audit = await auditRows(db, mailboxId);
      expect(audit.map((a) => a.action).sort()).toEqual(['keep', 'marked_protected']);
    });
  });

  describe('ownership', () => {
    it('404s a cross-mailbox sender id before any write', async () => {
      const otherMailbox = await seedMailbox(db, 'intruder');

      await expect(
        svc.setPolicy({
          mailboxAccountId: otherMailbox,
          senderId,
          patch: { isProtected: true },
        }),
      ).rejects.toMatchObject({ status: 404 });

      expect(await policyRow(db, mailboxId)).toBeNull();
      expect(await auditRows(db, otherMailbox)).toHaveLength(0);
    });
  });

  describe('capability round-trip (D42 protected-sender gate)', () => {
    it('a freshly Protected sender 409s the destructive Archive enqueue', async () => {
      await svc.setPolicy({ mailboxAccountId: mailboxId, senderId, patch: { isProtected: true } });

      // Minimal fake queue — the gate fires before any enqueue.
      const queue = { add: async () => undefined, getJob: async () => null };
      const actions = new ActionsService(db as never, queue as never);

      await expect(
        actions.enqueueComposite({
          mailboxAccountId: mailboxId,
          selector: { type: 'sender', senderId },
          primary: { type: 'archive' },
          idempotencyKey: 'click-protected-1',
          override: false,
        }),
      ).rejects.toMatchObject({ status: 409 });

      // Unprotect → the same enqueue goes through.
      await svc.setPolicy({ mailboxAccountId: mailboxId, senderId, patch: { isProtected: false } });
      const res = await actions.enqueueComposite({
        mailboxAccountId: mailboxId,
        selector: { type: 'sender', senderId },
        primary: { type: 'archive' },
        idempotencyKey: 'click-protected-2',
        override: false,
      });
      expect(res.status).toBe('queued');
    });
  });
});
