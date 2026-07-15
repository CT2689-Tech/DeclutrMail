import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';

import { users } from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { OnboardingPresetKeySchema } from '@declutrmail/shared/contracts';
import type {
  OnboardingFirstTriageMeta,
  OnboardingPresetKey,
  OnboardingPresetPicksResult,
  OnboardingState,
} from '@declutrmail/shared/contracts';

import { AutopilotReadService } from '../autopilot/autopilot.read-service.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { TriageReadService, type TriageQueueRow } from '../triage/triage.read-service.js';
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
const PREF_FIRST_TRIAGE_KEYS = 'onboardingFirstTriageKeys';
const PREF_SKIPPED = 'onboardingSkipped';

/** D112 — the guided practice run covers at most 3 senders. */
const FIRST_TRIAGE_PINNED_COUNT = 3;

/**
 * D112 — candidate pool size. Wide enough that the non-Keep +
 * unprotected filter still has material to pick 3 from.
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
    presetKeys: OnboardingPresetKey[],
  ): Promise<OnboardingPresetPicksResult> {
    await this.patchPreferences(userId, { [PREF_PRESET_PICKS]: presetKeys });

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
      presetKeys,
      rulesReconciled: reconciled,
      rulesSeeded: presetRules.length > 0,
    };
  }

  /**
   * GET /api/onboarding/first-triage (D112).
   *
   * First call PINS up to 3 candidates: the highest-confidence non-Keep,
   * unprotected rows from the triage queue — or, when confidence is
   * uniformly low, the 3 lowest-read-rate ones (small-mailbox edge
   * case per the plan). The pinned sender keys persist in
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
    });

    let pinnedKeys = readStringArray(prefs[PREF_FIRST_TRIAGE_KEYS]);
    if (pinnedKeys === null) {
      pinnedKeys = pickFirstTriageCandidates(queue).map((r) => r.senderKey);
      await this.patchPreferences(userId, { [PREF_FIRST_TRIAGE_KEYS]: pinnedKeys });
    }

    const pinnedSet = new Set(pinnedKeys);
    const remaining = queue.filter((r) => pinnedSet.has(r.senderKey));
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
 * so small mailboxes still get up to 3. The uniformly-low-confidence
 * fallback (3 lowest read-rate non-Keep) is unchanged from D112.
 */
export function pickFirstTriageCandidates(queue: TriageQueueRow[]): TriageQueueRow[] {
  const eligible = queue.filter((r) => r.verdict !== 'keep' && r.protectionReason === null);
  if (eligible.length === 0) return [];

  const uniformlyLow = eligible.every((r) => r.confidence < FIRST_TRIAGE_LOW_CONFIDENCE_BAR);
  if (uniformlyLow) {
    return [...eligible]
      .sort((a, b) => a.readRate - b.readRate)
      .slice(0, FIRST_TRIAGE_PINNED_COUNT);
  }

  const byConfidence = (rows: TriageQueueRow[]): TriageQueueRow[] =>
    [...rows].sort((a, b) => b.confidence - a.confidence);
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
  take([...keeps].sort((a, b) => b.readRate - a.readRate)[0]);
  take(byConfidence(eligible.filter((r) => r.verdict === 'archive' || r.verdict === 'later'))[0]);

  for (const row of byConfidence(eligible)) {
    if (picked.length >= FIRST_TRIAGE_PINNED_COUNT) break;
    take(row);
  }
  return picked.slice(0, FIRST_TRIAGE_PINNED_COUNT);
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

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((v): v is string => typeof v === 'string');
}
