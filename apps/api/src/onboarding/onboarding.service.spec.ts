import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  AUTOPILOT_PRESET_KEYS,
  activityLog,
  automationRules,
  mailboxAccounts,
  schema,
  senders,
  triageDecisions,
  users,
  workspaces,
} from '@declutrmail/db';
import { ONBOARDING_PRESET_KEYS } from '@declutrmail/shared/contracts';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { AutopilotReadService } from '../autopilot/autopilot.read-service.js';
import { TriageReadService, type TriageQueueRow } from '../triage/triage.read-service.js';
import { OnboardingService, pickFirstTriageCandidates } from './onboarding.service.js';

/**
 * OnboardingService integration tests (D106-D113).
 *
 * Real service against in-process PGlite with every migration applied
 * (same harness as `autopilot.read-service.spec.ts`). Covers the flow
 * flags' lifecycle (state → picks → complete), the D110 reconcile in
 * both seeded and pre-seed shapes, and the D112 pinning semantics —
 * the practice set must never shift under the user.
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

async function seedUserAndMailbox(
  db: Db,
  email: string,
): Promise<{ userId: string; mailboxId: string }> {
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
  return { userId: user!.id, mailboxId: mb!.id };
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

/** One sender + its engine decision — the minimum for a queue row. */
async function seedDecision(
  db: Db,
  mailboxAccountId: string,
  opts: {
    senderKey: string;
    verdict: 'keep' | 'archive' | 'unsubscribe' | 'later';
    confidence: number;
  },
): Promise<void> {
  const now = new Date();
  await db.insert(senders).values({
    mailboxAccountId,
    senderKey: opts.senderKey,
    displayName: `Sender ${opts.senderKey}`,
    email: `${opts.senderKey}@example.com`,
    domain: 'example.com',
    gmailCategory: 'promotions',
    firstSeenAt: now,
    lastSeenAt: now,
  });
  await db.insert(triageDecisions).values({
    mailboxAccountId,
    senderKey: opts.senderKey,
    verdict: opts.verdict,
    confidence: opts.confidence.toFixed(2),
    reasoning: 'test reasoning',
    generatedBy: 'template',
    expiresAt: new Date(Date.now() + 86_400_000),
  });
}

async function enabledByKey(db: Db, mailboxId: string): Promise<Record<string, boolean>> {
  const rows = await db
    .select({ presetKey: automationRules.presetKey, enabled: automationRules.enabled })
    .from(automationRules)
    .where(eq(automationRules.mailboxAccountId, mailboxId));
  return Object.fromEntries(rows.map((r) => [r.presetKey, r.enabled]));
}

function makeService(db: Db): OnboardingService {
  return new OnboardingService(
    db as never,
    new TriageReadService(db as never),
    new AutopilotReadService(db as never),
  );
}

describe('OnboardingService', () => {
  let db: Db;
  let service: OnboardingService;
  let userId: string;
  let mailboxId: string;

  beforeEach(async () => {
    db = await freshDb();
    service = makeService(db);
    ({ userId, mailboxId } = await seedUserAndMailbox(db, 'onboardee@example.com'));
  });

  it('shared-contract preset keys mirror the DB union exactly', () => {
    expect([...ONBOARDING_PRESET_KEYS]).toEqual([...AUTOPILOT_PRESET_KEYS]);
  });

  describe('getState', () => {
    it('fresh user: null onboardedAt, null picks, not skipped, 5-item catalog', async () => {
      const state = await service.getState(userId);
      expect(state.onboardedAt).toBeNull();
      expect(state.goal).toBeNull();
      expect(state.presetPicks).toBeNull();
      expect(state.skipped).toBe(false);
      expect(state.presets).toHaveLength(5);
    });

    it('catalog copy never uses the banned verb "Screen" as a label (§2.2)', async () => {
      const state = await service.getState(userId);
      for (const item of state.presets) {
        // "Screener" (feature name) is allowed; the bare verb is not.
        expect(item.name.replace(/Screener/g, '')).not.toMatch(/\bscreen\b/i);
      }
    });
  });

  describe('submitPresetPicks', () => {
    it('persists picks and reconciles seeded rules (enable picked, leave rest off)', async () => {
      await seedPresets(db, mailboxId);
      const result = await service.submitPresetPicks(userId, mailboxId, 'reduce_newsletters', [
        'auto_archive_low_engagement',
        'newsletter_graveyard',
      ]);
      expect(result.rulesSeeded).toBe(true);
      expect(result.rulesReconciled).toBe(2);

      const state = await service.getState(userId);
      expect(state.goal).toBe('reduce_newsletters');
      expect(state.presetPicks).toEqual(['auto_archive_low_engagement', 'newsletter_graveyard']);

      const enabled = await enabledByKey(db, mailboxId);
      expect(enabled).toEqual({
        auto_archive_low_engagement: true,
        auto_unsubscribe_noisy: false,
        auto_screen_new_senders: false,
        newsletter_graveyard: true,
        long_dormant_unsubscribe: false,
      });
    });

    it('re-submission reconciles deterministically (disables un-picked)', async () => {
      await seedPresets(db, mailboxId);
      await service.submitPresetPicks(userId, mailboxId, 'reduce_newsletters', [
        'auto_archive_low_engagement',
      ]);
      await service.submitPresetPicks(userId, mailboxId, 'clear_old_promotions', [
        'auto_unsubscribe_noisy',
      ]);

      const enabled = await enabledByKey(db, mailboxId);
      expect(enabled['auto_archive_low_engagement']).toBe(false);
      expect(enabled['auto_unsubscribe_noisy']).toBe(true);
    });

    it('pre-seed mailbox: picks persist durably, rulesSeeded=false', async () => {
      const result = await service.submitPresetPicks(userId, mailboxId, 'reduce_newsletters', [
        'newsletter_graveyard',
      ]);
      expect(result.rulesSeeded).toBe(false);
      expect(result.rulesReconciled).toBe(0);

      const state = await service.getState(userId);
      expect(state.presetPicks).toEqual(['newsletter_graveyard']);
    });

    it('empty picks is a valid submission (advances the machine, enables nothing)', async () => {
      await seedPresets(db, mailboxId);
      const result = await service.submitPresetPicks(userId, mailboxId, 'protect_important', []);
      expect(result.presetKeys).toEqual([]);

      const state = await service.getState(userId);
      expect(state.presetPicks).toEqual([]);
      const enabled = await enabledByKey(db, mailboxId);
      expect(Object.values(enabled).every((e) => e === false)).toBe(true);
    });

    it('mode stays observe after enabling (D10 observe-first)', async () => {
      await seedPresets(db, mailboxId);
      await service.submitPresetPicks(userId, mailboxId, 'reduce_newsletters', [
        'auto_archive_low_engagement',
      ]);
      const [rule] = await db
        .select({ mode: automationRules.mode })
        .from(automationRules)
        .where(
          and(
            eq(automationRules.mailboxAccountId, mailboxId),
            eq(automationRules.presetKey, 'auto_archive_low_engagement'),
          ),
        );
      expect(rule!.mode).toBe('observe');
    });
  });

  describe('complete', () => {
    it('sets onboarded_at once; idempotent re-call preserves the original stamp', async () => {
      const first = await service.complete(userId, { skipped: false });
      expect(first.onboardedAt).not.toBeNull();

      const second = await service.complete(userId, { skipped: false });
      expect(second.onboardedAt).toBe(first.onboardedAt);
    });

    it('records the D106 skip flag', async () => {
      const state = await service.complete(userId, { skipped: true });
      expect(state.skipped).toBe(true);
      expect(state.onboardedAt).not.toBeNull();
    });
  });

  describe('getFirstTriage', () => {
    it('pins a contrast lineup: one unsubscribe, one keep, one judgment call (2026-07-10 D112 amendment)', async () => {
      await seedDecision(db, mailboxId, { senderKey: 'k1', verdict: 'keep', confidence: 0.99 });
      await seedDecision(db, mailboxId, { senderKey: 'a1', verdict: 'archive', confidence: 0.9 });
      await seedDecision(db, mailboxId, { senderKey: 'a2', verdict: 'archive', confidence: 0.8 });
      await seedDecision(db, mailboxId, {
        senderKey: 'u1',
        verdict: 'unsubscribe',
        confidence: 0.7,
      });
      await seedDecision(db, mailboxId, { senderKey: 'l1', verdict: 'later', confidence: 0.6 });

      const read = await service.getFirstTriage(userId, mailboxId);
      expect(read.meta).toEqual({ pinned: 3, decided: 0 });
      // Slot 1: the unsubscribe payoff; slot 2: the keep (trust); slot 3:
      // the highest-confidence judgment call — NOT three near-identical
      // top-confidence rows.
      expect(read.rows.map((r) => r.senderKey).sort()).toEqual(['a1', 'k1', 'u1']);
    });

    it('the pinned set survives a new higher-confidence decision appearing', async () => {
      await seedDecision(db, mailboxId, { senderKey: 'a1', verdict: 'archive', confidence: 0.8 });
      await seedDecision(db, mailboxId, { senderKey: 'a2', verdict: 'archive', confidence: 0.7 });
      const first = await service.getFirstTriage(userId, mailboxId);
      expect(first.meta.pinned).toBe(2);

      // A late re-score produces a stronger candidate — must NOT slide in.
      await seedDecision(db, mailboxId, { senderKey: 'a3', verdict: 'archive', confidence: 0.95 });
      const second = await service.getFirstTriage(userId, mailboxId);
      expect(second.meta.pinned).toBe(2);
      expect(second.rows.map((r) => r.senderKey).sort()).toEqual(['a1', 'a2']);
    });

    it('a durable decision drops the row and bumps decided (D226 server confirmation)', async () => {
      await seedDecision(db, mailboxId, { senderKey: 'a1', verdict: 'archive', confidence: 0.9 });
      await seedDecision(db, mailboxId, { senderKey: 'a2', verdict: 'archive', confidence: 0.8 });
      await service.getFirstTriage(userId, mailboxId);

      // The durable decision record IS the activity_log verb row.
      await db.insert(activityLog).values({
        mailboxAccountId: mailboxId,
        senderKey: 'a1',
        source: 'triage',
        action: 'archive',
      });

      const read = await service.getFirstTriage(userId, mailboxId);
      expect(read.meta).toEqual({ pinned: 2, decided: 1 });
      expect(read.rows.map((r) => r.senderKey)).toEqual(['a2']);
    });

    it('empty queue pins zero candidates (tiny mailbox edge)', async () => {
      const read = await service.getFirstTriage(userId, mailboxId);
      expect(read.meta).toEqual({ pinned: 0, decided: 0 });
      expect(read.rows).toEqual([]);
    });
  });
});

describe('pickFirstTriageCandidates', () => {
  const row = (over: Partial<TriageQueueRow>): TriageQueueRow => ({
    id: 'id',
    senderId: 'sid',
    senderKey: 'sk',
    senderName: 'n',
    senderEmail: 'e@example.com',
    senderDomain: 'example.com',
    gmailCategory: 'promotions',
    unsubscribeMethod: 'none',
    verdict: 'archive',
    confidence: 0.9,
    reasoning: 'r',
    signals: [],
    protectionReason: null,
    monthlyVolume: 0,
    last90dMessages: 0,
    readRate: 0,
    lastDays: 0,
    totalAllTime: 0,
    ...over,
  });

  it('fills the trust slot with a keep/protected sender instead of excluding them', () => {
    const picked = pickFirstTriageCandidates([
      row({ senderKey: 'keep', verdict: 'keep', confidence: 0.99, readRate: 0.9 }),
      row({ senderKey: 'prot', protectionReason: 'replied', confidence: 0.98, readRate: 0.4 }),
      row({ senderKey: 'ok', confidence: 0.6 }),
    ]);
    // Highest read-rate keep wins the trust slot; keeps/protected never
    // fill the other slots (eligible pool still excludes them).
    expect(picked.map((r) => r.senderKey)).toEqual(['keep', 'ok']);
  });

  it('picks one row per teaching slot: unsubscribe payoff, keep trust, judgment call', () => {
    const picked = pickFirstTriageCandidates([
      row({ senderKey: 'u-low', verdict: 'unsubscribe', confidence: 0.7 }),
      row({ senderKey: 'u-high', verdict: 'unsubscribe', confidence: 0.95 }),
      row({ senderKey: 'k1', verdict: 'keep', confidence: 0.9, readRate: 0.9 }),
      row({
        senderKey: 'prot',
        protectionReason: 'replied',
        confidence: 0.8,
        readRate: 0.95,
      }),
      row({ senderKey: 'a1', verdict: 'archive', confidence: 0.9 }),
      row({ senderKey: 'l1', verdict: 'later', confidence: 0.85 }),
    ]);
    // NOT [u-high, a1, l1] (the old top-3-by-confidence). One per slot:
    // best unsubscribe, highest-read-rate keep, best archive/later.
    expect(picked.map((r) => r.senderKey)).toEqual(['u-high', 'prot', 'a1']);
  });

  it('backfills empty slots from the eligible pool by confidence', () => {
    const picked = pickFirstTriageCandidates([
      row({ senderKey: 'u1', verdict: 'unsubscribe', confidence: 0.9 }),
      row({ senderKey: 'u2', verdict: 'unsubscribe', confidence: 0.8 }),
      row({ senderKey: 'u3', verdict: 'unsubscribe', confidence: 0.7 }),
    ]);
    // No keep, no archive/later — still returns 3, not 1.
    expect(picked.map((r) => r.senderKey)).toEqual(['u1', 'u2', 'u3']);
  });

  it('ranks by confidence DESC normally', () => {
    const picked = pickFirstTriageCandidates([
      row({ senderKey: 'low', confidence: 0.6 }),
      row({ senderKey: 'high', confidence: 0.9 }),
      row({ senderKey: 'mid', confidence: 0.7 }),
      row({ senderKey: 'lowest', confidence: 0.55 }),
    ]);
    expect(picked.map((r) => r.senderKey)).toEqual(['high', 'mid', 'low']);
  });

  it('falls back to read-rate ASC when confidence is uniformly low (D112)', () => {
    const picked = pickFirstTriageCandidates([
      row({ senderKey: 'r3', confidence: 0.3, readRate: 0.3 }),
      row({ senderKey: 'r1', confidence: 0.4, readRate: 0.1 }),
      row({ senderKey: 'r2', confidence: 0.2, readRate: 0.2 }),
    ]);
    expect(picked.map((r) => r.senderKey)).toEqual(['r1', 'r2', 'r3']);
  });
});
