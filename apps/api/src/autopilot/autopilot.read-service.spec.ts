import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  AUTOPILOT_PRESET_KEYS,
  automationRules,
  mailboxAccounts,
  mailMessages,
  ruleMatchLog,
  schema,
  senders,
  triageDecisions,
  users,
  workspaces,
} from '@declutrmail/db';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

    it('D10 — observePromptDismissed=true stamps the dismissal; false clears it', async () => {
      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      const dismissed = await service.patchRule(mailboxA, ruleId, {
        observePromptDismissed: true,
      });
      expect(dismissed!.observePromptDismissedAt).not.toBeNull();

      const cleared = await service.patchRule(mailboxA, ruleId, {
        observePromptDismissed: false,
      });
      expect(cleared!.observePromptDismissedAt).toBeNull();
    });

    it('D10 — a mode transition re-arms the prompt (clears the dismissal)', async () => {
      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      await service.patchRule(mailboxA, ruleId, { observePromptDismissed: true });

      const paused = await service.patchRule(mailboxA, ruleId, { mode: 'paused' });
      expect(paused!.observePromptDismissedAt).toBeNull();

      // A non-mode PATCH does NOT touch the dismissal.
      await service.patchRule(mailboxA, ruleId, { observePromptDismissed: true });
      const toggled = await service.patchRule(mailboxA, ruleId, { enabled: true });
      expect(toggled!.observePromptDismissedAt).not.toBeNull();
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
      expect(result!.alreadyDismissed).toBe(false);
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

    it('second dismiss of the same match returns alreadyDismissed:true with the original resolvedAt', async () => {
      // Phase-1 idempotency contract (D202/D207): a repeat dismiss for
      // the same (mailbox, match) is a benign replay — it MUST NOT
      // collapse to 404 (which would be indistinguishable from "match
      // doesn't exist") and the terminal `resolvedAt` MUST match the
      // first call so clients can render the original timestamp.
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
      expect(first!.alreadyDismissed).toBe(false);
      const second = await service.dismissMatch(mailboxA, match!.id);
      expect(second).not.toBeNull();
      expect(second!.resolution).toBe('dismissed');
      expect(second!.alreadyDismissed).toBe(true);
      expect(second!.resolvedAt).toBe(first!.resolvedAt);
    });

    it('cross-tenant repeat-dismiss still returns null (404) — alreadyDismissed bypass is per-mailbox', async () => {
      // Dismiss B's match as B, then attempt the same match as A —
      // must NOT leak "match exists / is dismissed" via 200.
      const ruleIdB = await getRuleId(db, mailboxB, 'auto_archive_low_engagement');
      const [matchB] = await db
        .insert(ruleMatchLog)
        .values({
          ruleId: ruleIdB,
          mailboxAccountId: mailboxB,
          senderKey: 'a'.repeat(64),
          modeAtMatch: 'observe',
          confidence: '0.92',
          reason: 'tenant-b',
        })
        .returning({ id: ruleMatchLog.id });
      const dismissedAsB = await service.dismissMatch(mailboxB, matchB!.id);
      expect(dismissedAsB).not.toBeNull();
      expect(dismissedAsB!.alreadyDismissed).toBe(false);
      const crossTenant = await service.dismissMatch(mailboxA, matchB!.id);
      expect(crossTenant).toBeNull();
    });
  });

  describe('approveMatches (U14)', () => {
    function withQueue(): { svc: AutopilotReadService; add: ReturnType<typeof vi.fn> } {
      const add = vi.fn().mockResolvedValue(undefined);
      const svc = new AutopilotReadService(db as never, { add } as never);
      return { svc, add };
    }

    async function seedPendingMatch(mailboxId: string, presetKey = 'auto_archive_low_engagement') {
      const ruleId = await getRuleId(db, mailboxId, presetKey);
      const [m] = await db
        .insert(ruleMatchLog)
        .values({
          ruleId,
          mailboxAccountId: mailboxId,
          senderKey: 'c'.repeat(64),
          modeAtMatch: 'observe',
          confidence: '0.92',
          reason: 'approve-test',
        })
        .returning({ id: ruleMatchLog.id });
      return { ruleId, matchId: m!.id };
    }

    it('approves pending observe matches and enqueues the action sweep', async () => {
      const { svc, add } = withQueue();
      const { matchId } = await seedPendingMatch(mailboxA);

      const result = await svc.approveMatches(mailboxA, [matchId]);
      expect(result.approvedCount).toBe(1);
      expect(result.alreadyResolvedCount).toBe(0);
      expect(result.executionEnqueued).toBe(true);
      expect(add).toHaveBeenCalledTimes(1);

      const [row] = await db.select().from(ruleMatchLog).where(eq(ruleMatchLog.id, matchId));
      expect(row!.resolution).toBe('approved');
      expect(row!.resolvedAt).not.toBeNull();
      expect(row!.intentApplied).toBe(false);
    });

    it('is idempotent — a replay reports alreadyResolved and enqueues nothing', async () => {
      const { svc, add } = withQueue();
      const { matchId } = await seedPendingMatch(mailboxA);
      await svc.approveMatches(mailboxA, [matchId]);
      add.mockClear();

      const replay = await svc.approveMatches(mailboxA, [matchId]);
      expect(replay.approvedCount).toBe(0);
      expect(replay.alreadyResolvedCount).toBe(1);
      expect(replay.executionEnqueued).toBe(false);
      expect(add).not.toHaveBeenCalled();
    });

    it('cross-tenant ids are silently absent from both counts', async () => {
      const { svc } = withQueue();
      const { matchId } = await seedPendingMatch(mailboxB);
      const result = await svc.approveMatches(mailboxA, [matchId]);
      expect(result.approvedCount).toBe(0);
      expect(result.alreadyResolvedCount).toBe(0);
      const [row] = await db.select().from(ruleMatchLog).where(eq(ruleMatchLog.id, matchId));
      expect(row!.resolution).toBe('pending');
    });

    it('503s before any write when the action queue is not wired', async () => {
      const { matchId } = await seedPendingMatch(mailboxA);
      await expect(service.approveMatches(mailboxA, [matchId])).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      const [row] = await db.select().from(ruleMatchLog).where(eq(ruleMatchLog.id, matchId));
      expect(row!.resolution).toBe('pending');
    });

    it('approveAllForRule approves every pending row for the rule only', async () => {
      const add = vi.fn().mockResolvedValue(undefined);
      const svc = new AutopilotReadService(db as never, { add } as never);
      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      const otherRuleId = await getRuleId(db, mailboxA, 'newsletter_graveyard');
      await db.insert(ruleMatchLog).values([
        {
          ruleId,
          mailboxAccountId: mailboxA,
          senderKey: 'd'.repeat(64),
          modeAtMatch: 'observe' as const,
          confidence: '0.92',
          reason: 'r1',
        },
        {
          ruleId,
          mailboxAccountId: mailboxA,
          senderKey: 'e'.repeat(64),
          modeAtMatch: 'observe' as const,
          confidence: '0.92',
          reason: 'r2',
        },
        {
          ruleId: otherRuleId,
          mailboxAccountId: mailboxA,
          senderKey: 'f'.repeat(64),
          modeAtMatch: 'observe' as const,
          confidence: '0.92',
          reason: 'other-rule',
        },
      ]);

      const result = await svc.approveAllForRule(mailboxA, ruleId);
      expect(result).not.toBeNull();
      expect(result!.approvedCount).toBe(2);
      expect(result!.executionEnqueued).toBe(true);

      const pending = await db
        .select()
        .from(ruleMatchLog)
        .where(eq(ruleMatchLog.resolution, 'pending'));
      expect(pending).toHaveLength(1);
      expect(pending[0]!.ruleId).toBe(otherRuleId);

      // Cross-tenant rule id → null → controller 404.
      const ruleB = await getRuleId(db, mailboxB, 'auto_archive_low_engagement');
      expect(await svc.approveAllForRule(mailboxA, ruleB)).toBeNull();
    });
  });

  describe('previewRule (U14)', () => {
    it('runs the matcher against current signals and returns a metadata-only sample', async () => {
      const senderKey = 'a1'.repeat(32);
      await db.insert(senders).values({
        mailboxAccountId: mailboxA,
        senderKey,
        displayName: 'Shop Inc',
        email: 'deals@shop.com',
        domain: 'shop.com',
        gmailCategory: 'promotions',
        firstSeenAt: new Date('2024-01-01'),
        lastSeenAt: new Date(),
      });
      await db.insert(triageDecisions).values({
        mailboxAccountId: mailboxA,
        senderKey,
        verdict: 'archive',
        confidence: '0.92',
        reasoning: 'test',
        generatedBy: 'template',
        producedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      });

      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      const result = await service.previewRule(mailboxA, ruleId);
      expect(result).not.toBeNull();
      expect(result!.wouldMatchCount).toBe(1);
      expect(result!.evaluatedSenders).toBe(1);
      expect(result!.sample).toHaveLength(1);
      expect(result!.sample[0]!.senderName).toBe('Shop Inc');
      expect(result!.sample[0]!.senderEmail).toBe('deals@shop.com');
      expect(result!.sample[0]!.reason).toContain('Archive');

      // No mutation: preview writes no match rows.
      expect(await db.select().from(ruleMatchLog)).toHaveLength(0);
    });

    it('returns null for cross-tenant and custom rules (D234)', async () => {
      const ruleB = await getRuleId(db, mailboxB, 'auto_archive_low_engagement');
      expect(await service.previewRule(mailboxA, ruleB)).toBeNull();

      const [custom] = await db
        .insert(automationRules)
        .values({
          mailboxAccountId: mailboxA,
          isPreset: false,
          presetKey: null,
          name: 'Custom',
          enabled: false,
          mode: 'observe',
          scope: 'account',
          conditions: {},
          actionKind: 'archive',
          actionPayload: {},
        })
        .returning({ id: automationRules.id });
      expect(await service.previewRule(mailboxA, custom!.id)).toBeNull();
    });
  });

  describe('observe-window projection (U14 — D10/D104)', () => {
    it('projects observeWindowEndsAt = modeChangedAt + 7d while in observe mode', async () => {
      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      const changed = new Date('2026-06-01T00:00:00Z');
      await db
        .update(automationRules)
        .set({ modeChangedAt: changed })
        .where(eq(automationRules.id, ruleId));

      const rule = await service.getRule(mailboxA, ruleId);
      expect(rule!.observeWindowEndsAt).toBe('2026-06-08T00:00:00.000Z');
      // 2026-06-08 is in the past relative to the real clock → elapsed.
      expect(rule!.observeWindowElapsed).toBe(true);
    });

    it('is null / false outside observe mode', async () => {
      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      await db
        .update(automationRules)
        .set({ mode: 'active' })
        .where(eq(automationRules.id, ruleId));
      const rule = await service.getRule(mailboxA, ruleId);
      expect(rule!.observeWindowEndsAt).toBeNull();
      expect(rule!.observeWindowElapsed).toBe(false);
    });

    it('a fresh observe window has not elapsed', async () => {
      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      await db
        .update(automationRules)
        .set({ modeChangedAt: new Date() })
        .where(eq(automationRules.id, ruleId));
      const rule = await service.getRule(mailboxA, ruleId);
      expect(rule!.observeWindowElapsed).toBe(false);
      expect(rule!.observeWindowEndsAt).not.toBeNull();
    });
  });

  describe('observe digest (D10/D101)', () => {
    const SENDER_1 = 'd1'.repeat(32);
    const SENDER_2 = 'd2'.repeat(32);
    const SENDER_3 = 'd3'.repeat(32);
    const SENDER_4 = 'd4'.repeat(32);

    async function seedMessages(
      mailboxId: string,
      senderKey: string,
      counts: { inbox: number; archived: number },
    ): Promise<void> {
      const rows = [
        ...Array.from({ length: counts.inbox }, (_, i) => ({ labels: ['INBOX'], i, tag: 'in' })),
        ...Array.from({ length: counts.archived }, (_, i) => ({
          labels: [] as string[],
          i,
          tag: 'out',
        })),
      ];
      if (rows.length === 0) return;
      await db.insert(mailMessages).values(
        rows.map((r) => ({
          mailboxAccountId: mailboxId,
          providerMessageId: `${senderKey.slice(0, 8)}-${r.tag}-${r.i}`,
          providerThreadId: `t-${senderKey.slice(0, 8)}-${r.tag}-${r.i}`,
          senderKey,
          internalDate: new Date(),
          labelIds: r.labels,
          isUnread: false,
        })),
      );
    }

    async function seedPending(
      mailboxId: string,
      ruleId: string,
      senderKey: string,
      matchedAt: Date,
      resolution: 'pending' | 'dismissed' = 'pending',
    ): Promise<void> {
      await db.insert(ruleMatchLog).values({
        ruleId,
        mailboxAccountId: mailboxId,
        senderKey,
        modeAtMatch: 'observe',
        confidence: '0.90',
        reason: 'digest-test',
        matchedAt,
        resolution,
      });
    }

    it('counts pending observe matches joined to INBOX messages, scoped to the last 7 days', async () => {
      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      const now = Date.now();
      const oneDayAgo = new Date(now - 1 * 86_400_000);
      const twoDaysAgo = new Date(now - 2 * 86_400_000);
      const tenDaysAgo = new Date(now - 10 * 86_400_000);

      // Two in-window pending senders (≥2 rows on BOTH sides of the join).
      await seedPending(mailboxA, ruleId, SENDER_1, oneDayAgo);
      await seedPending(mailboxA, ruleId, SENDER_2, twoDaysAgo);
      // Out-of-window pending match — in pendingTotal, out of the 7d counts.
      await seedPending(mailboxA, ruleId, SENDER_3, tenDaysAgo);
      // Dismissed match — excluded everywhere.
      await seedPending(mailboxA, ruleId, SENDER_4, oneDayAgo, 'dismissed');

      // Messages: only INBOX-labelled rows count; archived rows do not.
      await seedMessages(mailboxA, SENDER_1, { inbox: 3, archived: 2 });
      await seedMessages(mailboxA, SENDER_2, { inbox: 1, archived: 0 });
      await seedMessages(mailboxA, SENDER_3, { inbox: 5, archived: 0 });
      await seedMessages(mailboxA, SENDER_4, { inbox: 4, archived: 0 });

      // Cross-tenant noise — same sender keys in mailbox B.
      const ruleB = await getRuleId(db, mailboxB, 'auto_archive_low_engagement');
      await seedPending(mailboxB, ruleB, SENDER_1, oneDayAgo);
      await seedMessages(mailboxB, SENDER_1, { inbox: 9, archived: 0 });

      const rules = await service.listRules(mailboxA);
      const rule = rules.find((r) => r.id === ruleId);
      expect(rule!.observeDigest).toEqual({
        pendingTotal: 3,
        senders7d: 2,
        messages7d: 4, // 3 (sender 1) + 1 (sender 2); archived + out-of-window excluded
      });

      // Tenant isolation — B sees only its own row.
      const bRules = await service.listRules(mailboxB);
      const bRule = bRules.find((r) => r.id === ruleB);
      expect(bRule!.observeDigest).toEqual({ pendingTotal: 1, senders7d: 1, messages7d: 9 });
    });

    it('zero-fills the digest for an observe rule with no pending matches', async () => {
      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      const rule = await service.getRule(mailboxA, ruleId);
      expect(rule!.observeDigest).toEqual({ pendingTotal: 0, senders7d: 0, messages7d: 0 });
    });

    it('is null outside observe mode even when stale pending rows exist', async () => {
      const ruleId = await getRuleId(db, mailboxA, 'auto_archive_low_engagement');
      await seedPending(mailboxA, ruleId, SENDER_1, new Date());
      await db
        .update(automationRules)
        .set({ mode: 'active' })
        .where(eq(automationRules.id, ruleId));
      const rule = await service.getRule(mailboxA, ruleId);
      expect(rule!.observeDigest).toBeNull();
    });
  });
});
