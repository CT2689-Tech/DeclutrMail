import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  AUTOPILOT_PRESET_KEYS,
  activityLog,
  automationRules,
  mailMessages,
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
    /**
     * Messages from this sender sitting in INBOX. Defaults to 3 because
     * the payoff gate drops any sender whose action would move nothing —
     * a seed with no inbox mail is a seed Step 5 correctly refuses to
     * pin. Pass 0 to exercise that.
     */
    inboxMessages?: number;
  },
): Promise<void> {
  const now = new Date();
  await db.insert(senders).values({
    mailboxAccountId,
    senderKey: opts.senderKey,
    displayName: `Sender ${opts.senderKey}`,
    email: `${opts.senderKey}@${opts.senderKey}.example`,
    // Distinct per sender: the lineup keeps one row per registrable
    // domain, so a shared domain would collapse the whole seed to one pin.
    domain: `${opts.senderKey}.example`,
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
  const inboxMessages = opts.inboxMessages ?? 3;
  if (inboxMessages > 0) {
    await db.insert(mailMessages).values(
      Array.from({ length: inboxMessages }, (_, index) => ({
        mailboxAccountId,
        providerMessageId: `${opts.senderKey}-msg-${index}`,
        providerThreadId: `${opts.senderKey}-thread-${index}`,
        senderKey: opts.senderKey,
        internalDate: now,
        isUnread: true,
        isOutbound: false,
        labelIds: ['INBOX'],
      })),
    );
  }
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
    it('pins only rows that would move mail, biggest first', async () => {
      // Supersedes the "five-sender contrast lineup" this test asserted
      // until 2026-08-07. That lineup was a teaching device — one
      // unsubscribe, one keep for trust, one judgment call, then backfill
      // by confidence — and it produced a first run that changed almost
      // nothing. `keep` never moves mail and `later` means the engine has
      // no opinion, so neither belongs in a step whose whole job is
      // proving the product does something.
      await seedDecision(db, mailboxId, { senderKey: 'k1', verdict: 'keep', confidence: 0.99 });
      await seedDecision(db, mailboxId, {
        senderKey: 'a1',
        verdict: 'archive',
        confidence: 0.9,
        inboxMessages: 4,
      });
      await seedDecision(db, mailboxId, {
        senderKey: 'a2',
        verdict: 'archive',
        confidence: 0.8,
        inboxMessages: 9,
      });
      await seedDecision(db, mailboxId, {
        senderKey: 'u1',
        verdict: 'unsubscribe',
        confidence: 0.7,
        inboxMessages: 2,
      });
      await seedDecision(db, mailboxId, { senderKey: 'l1', verdict: 'later', confidence: 0.6 });

      const read = await service.getFirstTriage(userId, mailboxId);
      // k1 (keep) and l1 (later) are gone; the rest rank by mail moved,
      // NOT by confidence — a2 leads on 9 despite the lowest score here.
      expect(read.meta).toEqual({ pinned: 3, decided: 0 });
      expect(read.rows.map((r) => r.senderKey)).toEqual(['a2', 'a1', 'u1']);
    });

    it('uses the persisted onboarding goal when creating the first pin', async () => {
      await service.submitPresetPicks(userId, mailboxId, 'protect_important', []);
      await seedDecision(db, mailboxId, {
        senderKey: 'u1',
        verdict: 'unsubscribe',
        confidence: 0.99,
      });
      await seedDecision(db, mailboxId, { senderKey: 'k1', verdict: 'keep', confidence: 0.6 });

      const read = await service.getFirstTriage(userId, mailboxId);
      expect(read.rows.map((r) => r.senderKey)).toEqual(['k1', 'u1']);
    });

    it('finds important senders beyond the default destructive-first queue window', async () => {
      await service.submitPresetPicks(userId, mailboxId, 'protect_important', []);
      for (let index = 0; index < 51; index += 1) {
        await seedDecision(db, mailboxId, {
          senderKey: `archive-${index.toString().padStart(2, '0')}`,
          verdict: 'archive',
          confidence: 0.99,
        });
      }
      await seedDecision(db, mailboxId, {
        senderKey: 'important-keep',
        verdict: 'keep',
        confidence: 0.4,
      });

      const read = await service.getFirstTriage(userId, mailboxId);
      expect(read.rows[0]?.senderKey).toBe('important-keep');
      expect(read.rows).toHaveLength(5);
    });

    it('brings high-payoff promotion cleanup into the candidate pool before the SQL limit', async () => {
      await service.submitPresetPicks(userId, mailboxId, 'clear_old_promotions', []);
      for (let index = 0; index < 51; index += 1) {
        await seedDecision(db, mailboxId, {
          senderKey: `low-${index.toString().padStart(2, '0')}`,
          verdict: 'archive',
          confidence: 0.99,
        });
      }
      await seedDecision(db, mailboxId, {
        senderKey: 'zz-useful-backlog',
        verdict: 'archive',
        confidence: 0.5,
      });
      await db
        .update(senders)
        .set({ totalReceived: 12 })
        .where(eq(senders.senderKey, 'zz-useful-backlog'));
      await db.insert(mailMessages).values(
        Array.from({ length: 12 }, (_, index) => ({
          mailboxAccountId: mailboxId,
          providerMessageId: `high-payoff-${index}`,
          providerThreadId: `high-payoff-thread-${index}`,
          senderKey: 'zz-useful-backlog',
          internalDate: new Date(),
          isUnread: true,
          isOutbound: false,
          labelIds: ['INBOX'],
        })),
      );

      const read = await service.getFirstTriage(userId, mailboxId);

      // The SQL limit runs before any JS ranking, so a high-payoff sender
      // has to survive the candidate-pool ordering first. It leads —
      // the low-volume rows may still follow, they simply cannot crowd
      // it out (which a confidence-only pool ordering allowed).
      expect(read.rows[0]?.senderKey).toBe('zz-useful-backlog');
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

    it('replaces pre-payoff pins so users already at Step 5 receive the improved lineup', async () => {
      await seedDecision(db, mailboxId, {
        senderKey: 'one-off',
        verdict: 'archive',
        confidence: 0.99,
      });
      await seedDecision(db, mailboxId, {
        senderKey: 'useful-backlog',
        verdict: 'archive',
        confidence: 0.8,
      });
      await db.insert(mailMessages).values([
        {
          mailboxAccountId: mailboxId,
          providerMessageId: 'one-off-0',
          providerThreadId: 'one-off-thread',
          senderKey: 'one-off',
          internalDate: new Date(),
          isUnread: true,
          isOutbound: false,
          labelIds: ['INBOX'],
        },
        ...Array.from({ length: 12 }, (_, index) => ({
          mailboxAccountId: mailboxId,
          providerMessageId: `useful-${index}`,
          providerThreadId: `useful-thread-${index}`,
          senderKey: 'useful-backlog',
          internalDate: new Date(),
          isUnread: true,
          isOutbound: false,
          labelIds: ['INBOX'],
        })),
      ]);
      await db
        .update(users)
        .set({
          preferences: {
            onboardingGoal: 'clear_old_promotions',
            onboardingFirstTriageKeys: ['one-off'],
          },
        })
        .where(eq(users.id, userId));

      const read = await service.getFirstTriage(userId, mailboxId);

      // The stored pin was ['one-off'] from an earlier ranking. The
      // version stamp forces a re-pick, and the re-pick orders by mail
      // actually moved — so the big backlog leads despite the lower
      // confidence. Without this bump a ranking fix reaches only accounts
      // that had not onboarded yet, because the picks live on the user.
      expect(read.meta).toEqual({ pinned: 2, decided: 0 });
      expect(read.rows.map((row) => row.senderKey)).toEqual(['useful-backlog', 'one-off']);
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
    // Derived from the key so every synthetic row is a DISTINCT brand by
    // default — the lineup keeps one row per registrable domain, and a
    // shared 'example.com' would collapse an entire fixture to one pin.
    // Tests about brand thinning set this explicitly.
    senderDomain: `${over.senderKey ?? 'sk'}.example`,
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
    totalAllTime: 10,
    // Positive by default so a row is pickable unless a test says
    // otherwise — the payoff gate requires mail actually in the inbox.
    inboxCount: 5,
    ...over,
  });

  it('drops rows whose action would move nothing — the only gate, and it is definitional', () => {
    const picked = pickFirstTriageCandidates(
      [
        row({ senderKey: 'empty', inboxCount: 0, totalAllTime: 400, confidence: 0.99 }),
        row({ senderKey: 'real', inboxCount: 3, totalAllTime: 3, confidence: 0.6 }),
      ],
      'clear_old_promotions',
    );
    // `empty` has 400 indexed messages and would have sailed through a
    // `totalAllTime >= 10` threshold — but every one is already filed, so
    // Archive moves zero mail. A row that changes nothing is not a decision.
    expect(picked.map((r) => r.senderKey)).toEqual(['real']);
  });

  it('never leads goal-led cleanup with `later` — that verdict means "no signal"', () => {
    const picked = pickFirstTriageCandidates(
      [
        row({ senderKey: 'dunno', verdict: 'later', confidence: 0.7, inboxCount: 900 }),
        row({ senderKey: 'sure', verdict: 'archive', confidence: 0.55, inboxCount: 12 }),
      ],
      'clear_old_promotions',
    );
    // `later` is `insufficient_signal` carrying a flat 0.70, which beats
    // most real scores (roughly 0.5 + 0.35 x strength). Ranking the two in
    // one bucket by confidence is exactly how the shipped screen came to
    // show five one-message senders. Volume does not rescue it: even at
    // 900 inbox messages, "we have no opinion" is not a first decision.
    expect(picked.map((r) => r.senderKey)).toEqual(['sure']);
  });

  it('shows fewer than five rather than padding with rows that move nothing', () => {
    const picked = pickFirstTriageCandidates(
      [
        row({ senderKey: 'a', inboxCount: 40 }),
        row({ senderKey: 'b', inboxCount: 12 }),
        row({ senderKey: 'c', inboxCount: 0 }),
        row({ senderKey: 'd', inboxCount: 0 }),
        row({ senderKey: 'e', inboxCount: 0 }),
      ],
      'clear_old_promotions',
    );
    expect(picked.map((r) => r.senderKey)).toEqual(['a', 'b']);
  });

  it('pins nothing at all when no row would move mail (the gate starved)', () => {
    // The blind case. If every candidate is a no-op the honest answer is
    // an empty step, not five buttons that do nothing. Step 5 renders its
    // "nothing worth reviewing" branch off this.
    expect(
      pickFirstTriageCandidates(
        [row({ senderKey: 'a', inboxCount: 0 }), row({ senderKey: 'b', inboxCount: 0 })],
        'clear_old_promotions',
      ),
    ).toEqual([]);
  });

  it('caps the pin at five candidates', () => {
    const picked = pickFirstTriageCandidates(
      Array.from({ length: 9 }, (_, i) =>
        row({ senderKey: `s${i}`, inboxCount: 100 - i, confidence: 0.9 }),
      ),
      'clear_old_promotions',
    );
    expect(picked).toHaveLength(5);
  });

  it('ranks promotion cleanup by Promotions first, then by mail actually moved', () => {
    const picked = pickFirstTriageCandidates(
      [
        row({ senderKey: 'promo-small', gmailCategory: 'promotions', inboxCount: 20 }),
        row({ senderKey: 'promo-big', gmailCategory: 'promotions', inboxCount: 300 }),
        row({ senderKey: 'other-huge', gmailCategory: 'updates', inboxCount: 900 }),
      ],
      'clear_old_promotions',
    );
    expect(picked.map((r) => r.senderKey)).toEqual(['promo-big', 'promo-small', 'other-huge']);
  });

  it('ranks newsletter relief by a usable unsubscribe channel before anything else', () => {
    const picked = pickFirstTriageCandidates(
      [
        row({ senderKey: 'no-channel', unsubscribeMethod: 'none', inboxCount: 800 }),
        row({
          senderKey: 'one-click',
          unsubscribeMethod: 'one_click',
          verdict: 'unsubscribe',
          inboxCount: 30,
          last90dMessages: 12,
        }),
      ],
      'reduce_newsletters',
    );
    // The goal is to stop future mail. A sender with no unsubscribe path
    // cannot serve it however big its backlog is.
    expect(picked.map((r) => r.senderKey)).toEqual(['one-click', 'no-channel']);
  });

  it('sorts an unknown read rate LAST, never as if it were 0% engagement', () => {
    const picked = pickFirstTriageCandidates(
      [
        row({ senderKey: 'silent', readRate: null, inboxCount: 10, gmailCategory: 'promotions' }),
        row({ senderKey: 'ignored', readRate: 0, inboxCount: 10, gmailCategory: 'promotions' }),
      ],
      'clear_old_promotions',
    );
    // Both have 10 inbox messages, so the read-rate term decides. `silent`
    // sent nothing in the window and has no rate to report; `ignored` has a
    // measured 0%. Ranking unknown as 0.00 made silence the strongest
    // possible cleanup signal, which is how quiet one-off senders reached
    // the front of a real 98k mailbox.
    expect(picked.map((r) => r.senderKey)).toEqual(['ignored', 'silent']);
  });

  it('shows one row per brand, keeping each brand\u2019s biggest', () => {
    // A real 23k mailbox carries 16 `icicibank.com` sender rows and 12
    // `zerodha.net`. Ranking by payoff alone hands the user the same logo
    // three times and calls it five decisions.
    const picked = pickFirstTriageCandidates(
      [
        row({ senderKey: 'z1', senderDomain: 'reportsmailer.zerodha.net', inboxCount: 500 }),
        row({ senderKey: 'z2', senderDomain: 'alertsmailer.zerodha.net', inboxCount: 221 }),
        row({ senderKey: 'z3', senderDomain: 'mailer.zerodha.net', inboxCount: 42 }),
        row({ senderKey: 'other', senderDomain: 'mailer.tatacliq.com', inboxCount: 30 }),
      ],
      'clear_old_promotions',
    );
    // Thinning is display-only: the surviving row still acts on its own
    // sender address, never the brand. Those Zerodha streams include
    // `auth@` login codes, so a row that archived "Zerodha" would sweep
    // them in with statements.
    expect(picked.map((r) => r.senderKey)).toEqual(['z1', 'other']);
  });

  it('keeps a brand split across sibling TLDs as separate rows', () => {
    // `zerodha.net` and `zerodha.com` are separate registrable domains —
    // the real Public Suffix List splits them too. Pinned so a future
    // reader knows it is a decision, not an oversight.
    const picked = pickFirstTriageCandidates(
      [
        row({ senderKey: 'net', senderDomain: 'mailer.zerodha.net', inboxCount: 221 }),
        row({ senderKey: 'com', senderDomain: 'mailer.zerodha.com', inboxCount: 19 }),
      ],
      'clear_old_promotions',
    );
    expect(picked.map((r) => r.senderKey)).toEqual(['net', 'com']);
  });

  it('never thins important senders by brand — colleagues share a mail provider', () => {
    // 260 keep/protected senders sit on `gmail.com` in one real mailbox.
    // Brand thinning would surface one and hide 259 — and this is the
    // screen for CORRECTING wrong protection, so a hidden row is a
    // mistake the user can never reach.
    const picked = pickFirstTriageCandidates(
      [
        row({ senderKey: 'a', verdict: 'keep', senderDomain: 'gmail.com', readRate: 0.9 }),
        row({ senderKey: 'b', verdict: 'keep', senderDomain: 'gmail.com', readRate: 0.8 }),
        row({ senderKey: 'c', verdict: 'keep', senderDomain: 'gmail.com', readRate: 0.7 }),
      ],
      'protect_important',
    );
    expect(picked.map((r) => r.senderKey)).toEqual(['a', 'b', 'c']);
  });

  it('orders important-sender review by Keep/protected, then high read rate', () => {
    const picked = pickFirstTriageCandidates(
      [
        row({ senderKey: 'eligible', verdict: 'archive', readRate: 0.9 }),
        row({ senderKey: 'quiet-keep', verdict: 'keep', readRate: null }),
        row({ senderKey: 'read-keep', verdict: 'keep', readRate: 0.8 }),
      ],
      'protect_important',
    );
    // Protection is not a cleanup action — nothing moves — so the payoff
    // gate does not apply here. Unknown read rate still sorts last.
    expect(picked.map((r) => r.senderKey)).toEqual(['read-keep', 'quiet-keep', 'eligible']);
  });
});
