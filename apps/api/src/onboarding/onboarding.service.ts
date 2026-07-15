import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';

import { users } from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { OnboardingGoalSchema, OnboardingPresetKeySchema } from '@declutrmail/shared/contracts';
import type {
  OnboardingFirstTriageMeta,
  OnboardingGoal,
  OnboardingPresetKey,
  OnboardingPresetPicksResult,
  OnboardingState,
} from '@declutrmail/shared/contracts';

import { AutopilotReadService } from '../autopilot/autopilot.read-service.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import {
  TriageReadService,
  type TriageQueueOrdering,
  type TriageQueueRow,
} from '../triage/triage.read-service.js';
import { ONBOARDING_PRESET_CATALOG } from './onboarding.types.js';

/**
 * The `users.preferences` keys this module owns (D106-D113). Naming
 * follows the existing camelCase precedent (`activeMailboxId`).
 *
 * - `onboardingPresetPicks`  — D110 step-4 submission. `string[]` of
 *   preset keys; absent = step 4 not submitted; `[]` = "no rules".
 *   ALSO read by `seedAutopilotPresets` (packages/workers) so picks
 *   submitted before the post-sync seeder runs are applied at seed
 *   time — the choice can never be silently lost.
 * - `onboardingFirstTriageKeys` — D112 step-5 pinned sender keys.
 *   Locked on first read so the practice set never shifts under the
 *   user mid-step.
 * - `onboardingSkipped` — D106 skip affordance flag.
 */
const PREF_PRESET_PICKS = 'onboardingPresetPicks';
const PREF_GOAL = 'onboardingGoal';
const PREF_FIRST_TRIAGE_KEYS = 'onboardingFirstTriageKeys';
const PREF_SKIPPED = 'onboardingSkipped';

/** D112/D246 — the finite first-relief run covers at most 5 senders. */
const FIRST_TRIAGE_PINNED_COUNT = 5;

/**
 * D112 — candidate pool size. Wide enough that the non-Keep +
 * unprotected filter still has material to pick 5 from.
 */
const FIRST_TRIAGE_POOL_LIMIT = 50;

/**
 * D112 — "engine confidence is uniformly low" fallback bar. When NO
 * candidate clears this confidence, ranking flips to lowest read rate
 * (the small-mailbox edge case in the plan).
 */
const FIRST_TRIAGE_LOW_CONFIDENCE_BAR = 0.5;

export interface FirstTriageRead {
  rows: TriageQueueRow[];
  meta: OnboardingFirstTriageMeta;
}

/**
 * OnboardingService (D106-D113).
 *
 * Owns the onboarding flow's durable flags on `users` and composes the
 * two mailbox-scoped reads the step machine needs. Cross-feature reads
 * go through the exported facades (`TriageReadService`,
 * `AutopilotReadService`) — no foreign table is touched directly, in
 * line with D204.
 *
 * Privacy (D7/D228): everything read or written here is flow metadata
 * (timestamps, preset keys, sha256 sender keys). The first-triage rows
 * come from the already-audited triage queue projection.
 */
@Injectable()
export class OnboardingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly triageReads: TriageReadService,
    private readonly autopilotReads: AutopilotReadService,
  ) {}

  /** GET /api/onboarding/state — the flags the step machine derives from. */
  async getState(userId: string): Promise<OnboardingState> {
    const user = await this.findUser(userId);
    const prefs = (user.preferences ?? {}) as Record<string, unknown>;
    return {
      onboardedAt: user.onboardedAt ? user.onboardedAt.toISOString() : null,
      skipped: prefs[PREF_SKIPPED] === true,
      goal: readGoal(prefs),
      presetPicks: readPresetPicks(prefs),
      presets: ONBOARDING_PRESET_CATALOG,
    };
  }

  /**
   * POST /api/onboarding/preset-picks (D110).
   *
   * Two writes, ordered so the choice cannot be silently lost:
   *
   *   1. Persist the picks in `users.preferences` — durable
   *      regardless of whether the mailbox's preset rules exist yet.
   *      `seedAutopilotPresets` reads this key at seed time.
   *   2. Reconcile every EXISTING preset rule for the mailbox to
   *      `enabled = (presetKey ∈ picks)`. Mode is untouched — rules
   *      stay in `observe` per D10 (observe-first; nothing acts
   *      without the user's approval).
   *
   * Idempotent: re-submitting the same picks is a no-op; re-submitting
   * different picks re-reconciles all 5 preset rows deterministically.
   */
  async submitPresetPicks(
    userId: string,
    mailboxAccountId: string,
    goal: OnboardingGoal,
    presetKeys: OnboardingPresetKey[],
  ): Promise<OnboardingPresetPicksResult> {
    await this.patchPreferences(userId, {
      [PREF_GOAL]: goal,
      [PREF_PRESET_PICKS]: presetKeys,
    });

    const rules = await this.autopilotReads.listRules(mailboxAccountId);
    const presetRules = rules.filter((r) => r.isPreset && r.presetKey !== null);
    const picked = new Set<string>(presetKeys);

    let reconciled = 0;
    for (const rule of presetRules) {
      const wantEnabled = picked.has(rule.presetKey as string);
      if (rule.enabled !== wantEnabled) {
        const updated = await this.autopilotReads.patchRule(mailboxAccountId, rule.id, {
          enabled: wantEnabled,
        });
        if (updated) reconciled += 1;
      }
    }

    return {
      goal,
      presetKeys,
      rulesReconciled: reconciled,
      rulesSeeded: presetRules.length > 0,
    };
  }

  /**
   * GET /api/onboarding/first-triage (D112).
   *
   * First call PINS up to 5 candidates, ordered for the user's persisted
   * relief goal. When no goal is stored, the deterministic D112 contrast
   * lineup remains the fallback. The pinned sender keys persist in
   * `users.preferences` so the practice set survives refreshes and
   * never shifts as decisions land.
   *
   * Subsequent calls return the pinned rows STILL awaiting a decision
   * (the queue read already excludes durably-decided senders — D226's
   * server-confirmation is the only way a row leaves). `decided` is
   * derived as `pinned - remaining`: a pinned sender that left the
   * queue for any reason (decision, protection, re-score to Keep) no
   * longer awaits practice, so completion stays reachable.
   */
  async getFirstTriage(userId: string, mailboxAccountId: string): Promise<FirstTriageRead> {
    const user = await this.findUser(userId);
    const prefs = (user.preferences ?? {}) as Record<string, unknown>;

    const queue = await this.triageReads.listQueue({
      mailboxAccountId,
      limit: FIRST_TRIAGE_POOL_LIMIT,
      ordering: firstTriageQueueOrdering(readGoal(prefs)),
    });

    let pinnedKeys = readStringArray(prefs[PREF_FIRST_TRIAGE_KEYS]);
    if (pinnedKeys === null) {
      pinnedKeys = pickFirstTriageCandidates(queue, readGoal(prefs)).map((r) => r.senderKey);
      await this.patchPreferences(userId, { [PREF_FIRST_TRIAGE_KEYS]: pinnedKeys });
    }

    const queueBySender = new Map(queue.map((row) => [row.senderKey, row]));
    const remaining = pinnedKeys.flatMap((senderKey) => {
      const row = queueBySender.get(senderKey);
      return row ? [row] : [];
    });
    return {
      rows: remaining,
      meta: {
        pinned: pinnedKeys.length,
        decided: pinnedKeys.length - remaining.length,
      },
    };
  }

  /**
   * POST /api/onboarding/complete (D113 / D106 skip).
   *
   * Sets `users.onboarded_at = now()` once; later calls are idempotent
   * (the original timestamp is preserved — the funnel measures first
   * completion). `skipped=true` additionally records the D106 skip
   * flag in preferences.
   *
   * D113's remaining side effects land elsewhere: the welcome email
   * rides the notifications infra (separate unit), and there is no
   * trial to start per D121.
   */
  async complete(userId: string, opts: { skipped: boolean }): Promise<OnboardingState> {
    const user = await this.findUser(userId);

    if (user.onboardedAt === null) {
      await this.db.update(users).set({ onboardedAt: new Date() }).where(eq(users.id, userId));
    }
    if (opts.skipped) {
      await this.patchPreferences(userId, { [PREF_SKIPPED]: true });
    }
    return this.getState(userId);
  }

  private async findUser(userId: string) {
    const [row] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!row) {
      throw new InternalServerErrorException(`User ${userId} not found.`);
    }
    return row;
  }

  /** Shallow preferences merge — same semantics as `UsersService.patchPreferences`. */
  private async patchPreferences(userId: string, patch: Record<string, unknown>): Promise<void> {
    const current = await this.findUser(userId);
    const merged = { ...(current.preferences as Record<string, unknown>), ...patch };
    await this.db.update(users).set({ preferences: merged }).where(eq(users.id, userId));
  }
}

function firstTriageQueueOrdering(goal: OnboardingGoal | null): TriageQueueOrdering {
  switch (goal) {
    case 'protect_important':
      return 'important-first';
    case 'reduce_newsletters':
      return 'newsletter-first';
    case 'clear_old_promotions':
      return 'promotions-first';
    case null:
      return 'actionable';
  }
}

/**
 * D112 candidate selection (contrast lineup — 2026-07-10 founder
 * amendment), pure for testability.
 *
 * The original "3 highest-confidence non-Keep" rule produced three
 * near-identical rows in practice (prod dogfood: 3× "Unsubscribe ·
 * 95% · quiet 90d") — teaching one verb and zero judgment. The
 * amended lineup picks one row per teaching slot:
 *
 *   1. payoff   — highest-confidence `unsubscribe` (the win)
 *   2. trust    — the obvious KEEP: `keep` verdict or an engagement-
 *                 protected sender, highest read-rate (shows the
 *                 engine can tell what matters — the reason to trust
 *                 slot 1)
 *   3. judgment — highest-confidence `archive`/`later` (the middle
 *                 verbs exist)
 *
 * Empty slots backfill from the remaining eligible pool by confidence
 * so small mailboxes still get up to 5. The uniformly-low-confidence
 * fallback (lowest read-rate non-Keep) is unchanged from D112.
 *
 * D246 adds goal-aware ordering for the initial immutable pin only:
 * newsletter relief prioritizes Unsubscribe, Promotions, then low read
 * rate; promotion cleanup prioritizes Promotions with Archive/Later;
 * important-sender review prioritizes Keep/protected rows and high read
 * rate. Sender key is the final tie-breaker so equal signals stay stable.
 */
export function pickFirstTriageCandidates(
  queue: TriageQueueRow[],
  goal: OnboardingGoal | null = null,
): TriageQueueRow[] {
  const eligible = queue.filter((r) => r.verdict !== 'keep' && r.protectionReason === null);
  if (goal === 'protect_important') {
    return [...queue]
      .sort(
        compareBy(
          (row) => (row.verdict === 'keep' || row.protectionReason !== null ? 0 : 1),
          (row) => -row.readRate,
          (row) => -row.confidence,
          (row) => row.senderKey,
        ),
      )
      .slice(0, FIRST_TRIAGE_PINNED_COUNT);
  }

  if (eligible.length === 0) return [];

  if (goal === 'reduce_newsletters') {
    return [...eligible]
      .sort(
        compareBy(
          (row) => (row.verdict === 'unsubscribe' ? 0 : 1),
          (row) => (row.gmailCategory === 'promotions' ? 0 : 1),
          (row) => row.readRate,
          (row) => -row.confidence,
          (row) => row.senderKey,
        ),
      )
      .slice(0, FIRST_TRIAGE_PINNED_COUNT);
  }

  if (goal === 'clear_old_promotions') {
    return [...eligible]
      .sort(
        compareBy(
          (row) => {
            const promotion = row.gmailCategory === 'promotions';
            const cleanup = row.verdict === 'archive' || row.verdict === 'later';
            if (promotion && cleanup) return 0;
            if (promotion) return 1;
            if (cleanup) return 2;
            return 3;
          },
          (row) => -row.confidence,
          (row) => row.senderKey,
        ),
      )
      .slice(0, FIRST_TRIAGE_PINNED_COUNT);
  }

  const uniformlyLow = eligible.every((r) => r.confidence < FIRST_TRIAGE_LOW_CONFIDENCE_BAR);
  if (uniformlyLow) {
    return [...eligible]
      .sort(
        compareBy(
          (row) => row.readRate,
          (row) => row.senderKey,
        ),
      )
      .slice(0, FIRST_TRIAGE_PINNED_COUNT);
  }

  const byConfidence = (rows: TriageQueueRow[]): TriageQueueRow[] =>
    [...rows].sort(
      compareBy(
        (row) => -row.confidence,
        (row) => row.senderKey,
      ),
    );
  const picked: TriageQueueRow[] = [];
  const taken = new Set<string>();
  const take = (row: TriageQueueRow | undefined): void => {
    if (row && !taken.has(row.senderKey)) {
      taken.add(row.senderKey);
      picked.push(row);
    }
  };

  take(byConfidence(eligible.filter((r) => r.verdict === 'unsubscribe'))[0]);
  const keeps = queue.filter((r) => r.verdict === 'keep' || r.protectionReason !== null);
  take(
    [...keeps].sort(
      compareBy(
        (row) => -row.readRate,
        (row) => row.senderKey,
      ),
    )[0],
  );
  take(byConfidence(eligible.filter((r) => r.verdict === 'archive' || r.verdict === 'later'))[0]);

  for (const row of byConfidence(eligible)) {
    if (picked.length >= FIRST_TRIAGE_PINNED_COUNT) break;
    take(row);
  }
  return picked.slice(0, FIRST_TRIAGE_PINNED_COUNT);
}

type SortValue = number | string;

function compareBy(
  ...selectors: Array<(row: TriageQueueRow) => SortValue>
): (a: TriageQueueRow, b: TriageQueueRow) => number {
  return (a, b) => {
    for (const select of selectors) {
      const left = select(a);
      const right = select(b);
      const compared =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right));
      if (compared !== 0) return compared;
    }
    return 0;
  };
}

/**
 * Parse the persisted picks list; null when never submitted. Unknown
 * strings (a removed preset key, a manual prefs edit) are dropped
 * rather than failing the whole state read.
 */
function readPresetPicks(prefs: Record<string, unknown>): OnboardingPresetKey[] | null {
  const raw = readStringArray(prefs[PREF_PRESET_PICKS]);
  if (raw === null) return null;
  return raw.filter(
    (k): k is OnboardingPresetKey => OnboardingPresetKeySchema.safeParse(k).success,
  );
}

function readGoal(prefs: Record<string, unknown>): OnboardingGoal | null {
  const parsed = OnboardingGoalSchema.safeParse(prefs[PREF_GOAL]);
  return parsed.success ? parsed.data : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((v): v is string => typeof v === 'string');
}
