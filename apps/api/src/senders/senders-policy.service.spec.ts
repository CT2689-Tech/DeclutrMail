import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  activityLog,
  mailboxAccounts,
  schema,
  senderPolicies,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { ActionsService } from '../actions/actions.service.js';
import { SendersPolicyService } from './senders-policy.service.js';

/**
 * SendersPolicyService integration tests (D40, D42, D43).
 *
 * Real service against in-process PGlite with every migration applied —
 * covers the three standing-policy mutations (Keep / VIP / Protect):
 * upsert semantics, the D43 audit rows, set-state idempotency (a
 * repeat patch is a no-op with no phantom audit row), the D22
 * protection provenance + user-agency memory pin, tenant ownership,
 * and the capability round-trip (a freshly Protected sender gates the
 * destructive Archive enqueue with 409 PROTECTED_SENDER).
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

const SENDER_KEY = 'c'.repeat(64);

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
        isVip: false,
        isProtected: false,
        changed: true,
      });

      const row = await policyRow(db, mailboxId);
      expect(row).toMatchObject({ policyType: 'keep', isVip: false, isProtected: false });

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

  describe('VIP toggle (D42, D43)', () => {
    it('flips is_vip true with a marked_vip audit row; protection fields untouched', async () => {
      const res = await svc.setPolicy({
        mailboxAccountId: mailboxId,
        senderId,
        patch: { isVip: true },
      });

      expect(res).toMatchObject({ isVip: true, isProtected: false, changed: true });

      const row = await policyRow(db, mailboxId);
      // VIP is its own modifier (D42 four-state matrix) — it must NOT
      // set is_protected / protection_reason; the engine cascade reads
      // `is_vip OR is_protected` so VIP alone already locks Keep.
      expect(row).toMatchObject({
        isVip: true,
        isProtected: false,
        protectionReason: null,
        protectionSetAt: null,
      });

      const audit = await auditRows(db, mailboxId);
      expect(audit.map((a) => a.action)).toEqual(['marked_vip']);
    });

    it('flips is_vip false with an unmarked_vip audit row', async () => {
      await svc.setPolicy({ mailboxAccountId: mailboxId, senderId, patch: { isVip: true } });
      const res = await svc.setPolicy({
        mailboxAccountId: mailboxId,
        senderId,
        patch: { isVip: false },
      });

      expect(res.isVip).toBe(false);
      expect(res.changed).toBe(true);
      const audit = await auditRows(db, mailboxId);
      expect(audit.map((a) => a.action)).toEqual(['marked_vip', 'unmarked_vip']);
    });

    it('no-op un-VIP on a sender with no policy row creates NOTHING', async () => {
      const res = await svc.setPolicy({
        mailboxAccountId: mailboxId,
        senderId,
        patch: { isVip: false },
      });

      expect(res).toMatchObject({ isVip: false, policyType: null, changed: false });
      expect(await policyRow(db, mailboxId)).toBeNull();
      expect(await auditRows(db, mailboxId)).toHaveLength(0);
    });

    it('does not clobber a standing unsubscribe verdict or Protect state', async () => {
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY,
        policyType: 'unsubscribe',
        isProtected: true,
        protectionReason: 'engagement_based',
        protectionSetAt: new Date('2026-05-01'),
      });

      const res = await svc.setPolicy({
        mailboxAccountId: mailboxId,
        senderId,
        patch: { isVip: true },
      });

      expect(res).toMatchObject({
        policyType: 'unsubscribe',
        isVip: true,
        isProtected: true,
        protectionReason: 'engagement_based',
      });
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
        protectionReason: 'engagement_based',
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
      // re-protect guard (`reason <> 'engagement_based'`) skips this
      // row instead of silently re-protecting on the next sync.
      expect(res.protectionReason).toBe('engagement_based');

      const audit = await auditRows(db, mailboxId);
      expect(audit.map((a) => a.action)).toEqual(['unmarked_protected']);
    });

    it('manual re-protect of a demoted engagement row upgrades provenance to user_defined', async () => {
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY,
        policyType: 'keep',
        isProtected: false,
        protectionReason: 'engagement_based',
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
        patch: { policyType: 'keep', isVip: true, isProtected: true },
      });

      expect(res).toMatchObject({
        policyType: 'keep',
        isVip: true,
        isProtected: true,
        protectionReason: 'user_defined',
        changed: true,
      });

      const audit = await auditRows(db, mailboxId);
      expect(audit.map((a) => a.action).sort()).toEqual(['keep', 'marked_protected', 'marked_vip']);
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
        actions.enqueueArchive({
          mailboxAccountId: mailboxId,
          selector: { type: 'sender', senderId },
          idempotencyKey: 'click-protected-1',
          override: false,
        }),
      ).rejects.toMatchObject({ status: 409 });

      // Unprotect → the same enqueue goes through.
      await svc.setPolicy({ mailboxAccountId: mailboxId, senderId, patch: { isProtected: false } });
      const res = await actions.enqueueArchive({
        mailboxAccountId: mailboxId,
        selector: { type: 'sender', senderId },
        idempotencyKey: 'click-protected-2',
        override: false,
      });
      expect(res.status).toBe('queued');
    });
  });
});
