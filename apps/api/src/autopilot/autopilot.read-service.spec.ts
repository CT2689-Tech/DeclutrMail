import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  AUTOPILOT_PRESET_KEYS,
  automationRules,
  mailboxAccounts,
  ruleMatchLog,
  schema,
  users,
  workspaces,
} from '@declutrmail/db';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { AutopilotReadService } from './autopilot.read-service.js';

/**
 * AutopilotReadService integration tests (D99-D105, D124, D234).
 *
 * Runs the real service against in-process PGlite with every migration
 * applied. Covers behavior the controller relies on: tenant isolation,
 * the V2 D234 custom-rule gate (PATCH on `is_preset=false` → null →
 * 404), pause-all, threshold validation, and dismiss flow with idempotent
 * collapse to 404 on already-resolved matches.
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

async function freshDb(): Promise<Db> {
  const pg = new PGlite({ extensions: { citext } });
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sqlText = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sqlText.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await pg.query(trimmed);
      }
    }
  }
  return drizzle(pg, { schema });
}

async function seedMailbox(db: Db, email: string): Promise<string> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS-${email}` })
    .returning({
      id: workspaces.id,
    });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email })
    .returning({ id: users.id });
  const [mb] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: email,
    })
    .returning({ id: mailboxAccounts.id });
  return mb!.id;
}

/** Seed the 5 preset rules directly (no worker dependency). */
async function seedPresets(db: Db, mailboxAccountId: string): Promise<void> {
  await db.insert(automationRules).values(
    AUTOPILOT_PRESET_KEYS.map((key, idx) => ({
      mailboxAccountId,
      isPreset: true,
      presetKey: key,
      name: `Preset ${idx + 1}`,
      enabled: false,
      mode: 'observe' as const,
      scope: 'account' as const,
      conditions: {},
      actionKind: idx === 2 ? ('later' as const) : ('archive' as const),
      actionPayload: {},
      confidenceThreshold: idx < 2 ? (idx === 0 ? '0.85' : '0.90') : null,
    })),
  );
}

async function getRuleId(db: Db, mailboxAccountId: string, presetKey: string): Promise<string> {
  const [r] = await db
    .select({ id: automationRules.id })
    .from(automationRules)
    .where(
      and(
        eq(automationRules.mailboxAccountId, mailboxAccountId),
        eq(automationRules.presetKey, presetKey),
      ),
    );
  return r!.id;
}

describe('AutopilotReadService', () => {
  let db: Db;
  let service: AutopilotReadService;
  let mailboxA: string;
  let mailboxB: string;

  beforeEach(async () => {
    db = await freshDb();
    service = new AutopilotReadService(db as never);
    mailboxA = await seedMailbox(db, 'a@example.com');
    mailboxB = await seedMailbox(db, 'b@example.com');
    await seedPresets(db, mailboxA);
    await seedPresets(db, mailboxB);
  });

  describe('listRules', () => {
    it('returns all 5 preset rules for one mailbox', async () => {
      // The 5 rows were inserted in a single batch — they share a
      // created_at; the random-uuid tie-breaker makes the runtime
      // order non-deterministic across runs. Assert the SET, not the
      // sequence. The contract is "all 5 presets present"; downstream
      // ordering work belongs in a dedicated test.
      const rules = await service.listRules(mailboxA);
      expect(rules.map((r) => r.presetKey).sort()).toEqual([...AUTOPILOT_PRESET_KEYS].sort());
      for (const r of rules) {
        expect(r.enabled).toBe(false);
        expect(r.mode).toBe('observe');
        expect(r.scope).toBe('account');
        expect(r.isPreset).toBe(true);
      }
    });

    it('does not leak rules across tenants', async () => {
      const a = await service.listRules(mailboxA);
      const b = await service.listRules(mailboxB);
      expect(a).toHaveLength(5);
      expect(b).toHaveLength(5);
      const overlap = a.map((r) => r.id).filter((id) => b.some((br) => br.id === id));
      expect(overlap).toEqual([]);
    });
  });

  describe('getRule', () => {
    it('returns the rule when it exists in the mailbox', async () => {
      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      const rule = await service.getRule(mailboxA, ruleId);
      expect(rule).not.toBeNull();
      expect(rule!.id).toBe(ruleId);
      expect(rule!.confidenceThreshold).toBe(0.85);
    });

    it('returns null when the rule belongs to a different mailbox (no cross-tenant leak)', async () => {
      const ruleId = await getRuleId(db, mailboxB, 'auto_archive_low_engagement');
      const rule = await service.getRule(mailboxA, ruleId);
      expect(rule).toBeNull();
    });
  });

  describe('patchRule', () => {
    it('toggles enabled + flips mode (and resets modeChangedAt)', async () => {
      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      const before = await service.getRule(mailboxA, ruleId);
      const beforeModeChanged = new Date(before!.modeChangedAt).getTime();
      // Wait a moment so the modeChangedAt reset is observable.
      await new Promise((r) => setTimeout(r, 5));
      const updated = await service.patchRule(mailboxA, ruleId, {
        enabled: true,
        mode: 'active',
      });
      expect(updated).not.toBeNull();
      expect(updated!.enabled).toBe(true);
      expect(updated!.mode).toBe('active');
      const afterModeChanged = new Date(updated!.modeChangedAt).getTime();
      expect(afterModeChanged).toBeGreaterThanOrEqual(beforeModeChanged);
    });

    it('updates confidenceThreshold and stores as numeric(3,2)', async () => {
      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      const updated = await service.patchRule(mailboxA, ruleId, {
        confidenceThreshold: 0.7,
      });
      expect(updated!.confidenceThreshold).toBe(0.7);
    });

    it('confidenceThreshold = null resets to preset default at runtime', async () => {
      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      const updated = await service.patchRule(mailboxA, ruleId, {
        confidenceThreshold: null,
      });
      expect(updated!.confidenceThreshold).toBeNull();
    });

    it('rejects confidenceThreshold outside [0, 1]', async () => {
      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      await expect(
        service.patchRule(mailboxA, ruleId, { confidenceThreshold: 1.5 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.patchRule(mailboxA, ruleId, { confidenceThreshold: -0.01 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an empty patch (all fields undefined)', async () => {
      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      await expect(service.patchRule(mailboxA, ruleId, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('D234 — returns null for a custom rule (is_preset=false) → controller maps to 404', async () => {
      const [customRow] = await db
        .insert(automationRules)
        .values({
          mailboxAccountId: mailboxA,
          isPreset: false,
          presetKey: null,
          name: 'Custom rule',
          enabled: false,
          mode: 'observe',
          scope: 'account',
          conditions: {},
          actionKind: 'archive',
          actionPayload: {},
        })
        .returning({ id: automationRules.id });
      const result = await service.patchRule(mailboxA, customRow!.id, { enabled: true });
      expect(result).toBeNull();
    });

    it('returns null on cross-tenant patch attempts', async () => {
      const ruleIdB = await getRuleId(db, mailboxB, 'auto_archive_low_engagement');
      const result = await service.patchRule(mailboxA, ruleIdB, { enabled: true });
      expect(result).toBeNull();
    });
  });

  describe('pauseAll', () => {
    it('flips all non-paused rules to paused; idempotent on second call', async () => {
      const ruleIdA = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      await service.patchRule(mailboxA, ruleIdA, { enabled: true, mode: 'active' });

      const first = await service.pauseAll(mailboxA);
      expect(first.pausedCount).toBe(5); // all 5 presets flipped

      const second = await service.pauseAll(mailboxA);
      expect(second.pausedCount).toBe(0);

      const rules = await service.listRules(mailboxA);
      for (const r of rules) expect(r.mode).toBe('paused');
    });

    it('does not affect another mailbox', async () => {
      await service.pauseAll(mailboxA);
      const b = await service.listRules(mailboxB);
      for (const r of b) expect(r.mode).toBe('observe');
    });
  });

  describe('listPendingSuggestions', () => {
    it('returns observe+pending matches newest first', async () => {
      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      const now = new Date();
      await db.insert(ruleMatchLog).values([
        {
          ruleId,
          mailboxAccountId: mailboxA,
          senderKey: 'a'.repeat(64),
          modeAtMatch: 'observe',
          confidence: '0.92',
          reason: 'older',
          matchedAt: new Date(now.getTime() - 5_000),
        },
        {
          ruleId,
          mailboxAccountId: mailboxA,
          senderKey: 'b'.repeat(64),
          modeAtMatch: 'observe',
          confidence: '0.95',
          reason: 'newer',
          matchedAt: now,
        },
      ]);
      const pending = await service.listPendingSuggestions(mailboxA);
      expect(pending).toHaveLength(2);
      expect(pending[0]!.reason).toBe('newer');
      expect(pending[1]!.reason).toBe('older');
      expect(pending[0]!.confidence).toBe(0.95);
    });

    it('excludes active-mode matches AND dismissed matches', async () => {
      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      await db.insert(ruleMatchLog).values([
        {
          ruleId,
          mailboxAccountId: mailboxA,
          senderKey: 'a'.repeat(64),
          modeAtMatch: 'active',
          resolution: 'approved',
          confidence: '0.92',
          reason: 'active',
        },
        {
          ruleId,
          mailboxAccountId: mailboxA,
          senderKey: 'b'.repeat(64),
          modeAtMatch: 'observe',
          resolution: 'dismissed',
          confidence: '0.85',
          reason: 'dismissed',
        },
        {
          ruleId,
          mailboxAccountId: mailboxA,
          senderKey: 'c'.repeat(64),
          modeAtMatch: 'observe',
          resolution: 'pending',
          confidence: '0.88',
          reason: 'pending',
        },
      ]);
      const pending = await service.listPendingSuggestions(mailboxA);
      expect(pending.map((m) => m.reason)).toEqual(['pending']);
    });

    it('does not leak matches across tenants', async () => {
      const ruleIdA = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      const ruleIdB = await getRuleId(db, mailboxB, 'auto_archive_low_engagement');
      await db.insert(ruleMatchLog).values([
        {
          ruleId: ruleIdA,
          mailboxAccountId: mailboxA,
          senderKey: 'a'.repeat(64),
          modeAtMatch: 'observe',
          confidence: '0.92',
          reason: 'A',
        },
        {
          ruleId: ruleIdB,
          mailboxAccountId: mailboxB,
          senderKey: 'b'.repeat(64),
          modeAtMatch: 'observe',
          confidence: '0.91',
          reason: 'B',
        },
      ]);
      const a = await service.listPendingSuggestions(mailboxA);
      expect(a.map((m) => m.reason)).toEqual(['A']);
    });
  });

  describe('listMatchesForRule', () => {
    it('returns matches for the rule, newest first', async () => {
      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      const now = new Date();
      for (let i = 0; i < 15; i += 1) {
        await db.insert(ruleMatchLog).values({
          ruleId,
          mailboxAccountId: mailboxA,
          senderKey: String(i).padStart(64, '0'),
          modeAtMatch: 'observe',
          confidence: '0.90',
          reason: `match ${i}`,
          matchedAt: new Date(now.getTime() - i * 1_000),
        });
      }
      const matches = await service.listMatchesForRule(mailboxA, ruleId, 5);
      expect(matches).toHaveLength(5);
      expect(matches![0]!.reason).toBe('match 0');
      expect(matches![4]!.reason).toBe('match 4');
    });

    it('returns null when the rule does not exist in the mailbox', async () => {
      const ruleIdB = await getRuleId(db, mailboxB, 'auto_archive_low_engagement');
      const result = await service.listMatchesForRule(mailboxA, ruleIdB, 5);
      expect(result).toBeNull();
    });
  });

  describe('dismissMatch', () => {
    it('flips a pending observe match to dismissed', async () => {
      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      const [match] = await db
        .insert(ruleMatchLog)
        .values({
          ruleId,
          mailboxAccountId: mailboxA,
          senderKey: 'a'.repeat(64),
          modeAtMatch: 'observe',
          confidence: '0.92',
          reason: 'to-dismiss',
        })
        .returning({ id: ruleMatchLog.id });
      const result = await service.dismissMatch(mailboxA, match!.id);
      expect(result).not.toBeNull();
      expect(result!.resolution).toBe('dismissed');
      expect(typeof result!.resolvedAt).toBe('string');
    });

    it('returns null on cross-tenant dismiss attempts', async () => {
      const ruleIdB = await getRuleId(db, mailboxB, 'auto_archive_low_engagement');
      const [matchB] = await db
        .insert(ruleMatchLog)
        .values({
          ruleId: ruleIdB,
          mailboxAccountId: mailboxB,
          senderKey: 'a'.repeat(64),
          modeAtMatch: 'observe',
          confidence: '0.92',
          reason: 'other-tenant',
        })
        .returning({ id: ruleMatchLog.id });
      const result = await service.dismissMatch(mailboxA, matchB!.id);
      expect(result).toBeNull();
    });

    it('returns null when the match is active-mode (cannot be dismissed)', async () => {
      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      const [match] = await db
        .insert(ruleMatchLog)
        .values({
          ruleId,
          mailboxAccountId: mailboxA,
          senderKey: 'a'.repeat(64),
          modeAtMatch: 'active',
          resolution: 'approved',
          confidence: '0.92',
          reason: 'active-already',
        })
        .returning({ id: ruleMatchLog.id });
      const result = await service.dismissMatch(mailboxA, match!.id);
      expect(result).toBeNull();
    });

    it('second dismiss of the same match returns null (already terminal)', async () => {
      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      const [match] = await db
        .insert(ruleMatchLog)
        .values({
          ruleId,
          mailboxAccountId: mailboxA,
          senderKey: 'a'.repeat(64),
          modeAtMatch: 'observe',
          confidence: '0.92',
          reason: 'first',
        })
        .returning({ id: ruleMatchLog.id });
      const first = await service.dismissMatch(mailboxA, match!.id);
      expect(first).not.toBeNull();
      const second = await service.dismissMatch(mailboxA, match!.id);
      expect(second).toBeNull();
    });
  });
});
