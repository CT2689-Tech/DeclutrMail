import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';

import { users } from '@declutrmail/db';
import { eq, sql } from 'drizzle-orm';
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
const PREF_FIRST_TRIAGE_VERSION = 'onboardingFirstTriageVersion';
const PREF_SKIPPED = 'onboardingSkipped';

/** D112/D246 — the finite first-relief run covers at most 5 senders. */
const FIRST_TRIAGE_PINNED_COUNT = 5;

/** Version 3 ranks by mail an action actually moves. Bumping re-pins
 * accounts onboarded under an earlier ranking — without it a fix helps
 * nobody who already signed up, because the picks are stored per user. */
const FIRST_TRIAGE_PIN_VERSION = 3;

/**
 * D112 — candidate pool size.
 *
 * The SQL now mirrors every rejection this file makes, so the pool no
 * longer has to absorb those. What it must absorb is brand thinning:
 * `pickTopDistinctBrands` keeps one row per registrable domain, and a
 * real 23k mailbox carries 16 `icicibank.com` rows, 12 `zerodha.net` and
 * 10 `nse.co.in`. A pool whose top rows are one brand yields one pin, so
 * the limit has to leave room for the collapse.
 *
 * 200 covers the worst fragmentation observed (16 rows for a single
 * brand) many times over while staying a bounded, indexed read.
 */
const FIRST_TRIAGE_POOL_LIMIT = 200;

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

    const goal = readGoal(prefs);
    const queue = await this.triageReads.listQueue({
      mailboxAccountId,
      limit: FIRST_TRIAGE_POOL_LIMIT,
      ordering: firstTriageQueueOrdering(goal),
      // Cleanup goals reject Keep, Protected and empty-inbox senders, so
      // the pool must not spend its 50 slots on them. `protect_important`
      // wants exactly those rows and keeps the unfiltered pool.
      requireCleanupCandidate: goal !== 'protect_important',
    });

    let pinnedKeys = readStringArray(prefs[PREF_FIRST_TRIAGE_KEYS]);
    const pinVersion = prefs[PREF_FIRST_TRIAGE_VERSION];
    if (pinnedKeys === null || pinVersion !== FIRST_TRIAGE_PIN_VERSION) {
      pinnedKeys = pickFirstTriageCandidates(queue, readGoal(prefs)).map((r) => r.senderKey);
      await this.patchPreferences(userId, {
        [PREF_FIRST_TRIAGE_KEYS]: pinnedKeys,
        [PREF_FIRST_TRIAGE_VERSION]: FIRST_TRIAGE_PIN_VERSION,
      });
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

  /**
   * Shallow preferences merge — same semantics as
   * `UsersService.patchPreferences`: an ATOMIC in-database `||`, so a
   * concurrent writer's key (e.g. a D165 unsubscribe flip) cannot be
   * overwritten by a stale JS-side snapshot.
   */
  private async patchPreferences(userId: string, patch: Record<string, unknown>): Promise<void> {
    await this.db
      .update(users)
      .set({
        // CASE repairs a malformed non-object root: jsonb `||` on an
        // array/scalar root CONCATENATES into an array.
        preferences: sql`CASE
          WHEN jsonb_typeof(${users.preferences}) = 'object' THEN ${users.preferences}
          ELSE '{}'::jsonb
        END || ${JSON.stringify(patch)}::jsonb`,
      })
      .where(eq(users.id, userId));
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
/**
 * Public suffixes whose second-to-last label is part of the suffix, so
 * the registrable name sits one label further left (`cdslindia.co.in`,
 * not `co.in`). Not the full Public Suffix List — a dependency that size
 * is not worth carrying for a five-row lineup, and the failure mode is
 * benign: see `registrableDomain`.
 */
const TWO_PART_PUBLIC_SUFFIX_SLDS = new Set(['co', 'com', 'net', 'org', 'gov', 'ac', 'edu']);

/**
 * Best-effort registrable domain — `reportsmailer.zerodha.net` and
 * `alertsmailer.zerodha.net` both collapse to `zerodha.net`.
 *
 * Deliberately a heuristic rather than the Public Suffix List. It is used
 * ONLY to thin the first-run lineup, never to widen an action, so a
 * wrong answer costs one duplicate row or one merged row — not mail moved
 * from a sender the user did not choose.
 *
 * Two known edges, both accepted:
 *   - Shared-sender domains (`*.myshopify.com`, ESP relays) OVER-merge,
 *     hiding a distinct business behind another.
 *   - A brand on sibling TLDs UNDER-merges: `zerodha.net` and
 *     `zerodha.com` are separate registrable domains and stay separate
 *     rows. The real Public Suffix List would split them too — only
 *     brand-name matching would not, and that is fuzzier than the
 *     problem warrants here.
 */
function registrableDomain(domain: string): string {
  const parts = domain.toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const tld = parts[parts.length - 1]!;
  const sld = parts[parts.length - 2]!;
  const twoPartSuffix = tld.length === 2 && TWO_PART_PUBLIC_SUFFIX_SLDS.has(sld);
  return parts.slice(twoPartSuffix ? -3 : -2).join('.');
}

/**
 * Take the top rows, at most one per brand.
 *
 * A real 23k mailbox carries 16 `icicibank.com` sender rows, 12
 * `zerodha.net`, 10 `nse.co.in` — so ranking by payoff alone hands the
 * user the same logo three times and calls it five decisions.
 *
 * Thinning happens AFTER the ranking and affects only which rows are
 * shown. The action still targets the single sender address on the row,
 * and that restraint is the point: those 12 Zerodha rows are different
 * streams — contract notes (500), margin statements (500), alerts
 * (221) — and one of them is `auth@mailer.zerodha.net`. A row that
 * archived "Zerodha" would sweep login codes in with statements.
 * Merging what we DISPLAY is safe; merging what we ACT ON is not.
 */
function pickTopDistinctBrands(ranked: TriageQueueRow[]): TriageQueueRow[] {
  const seen = new Set<string>();
  const picked: TriageQueueRow[] = [];
  for (const row of ranked) {
    if (picked.length >= FIRST_TRIAGE_PINNED_COUNT) break;
    const brand = registrableDomain(row.senderDomain);
    if (seen.has(brand)) continue;
    seen.add(brand);
    picked.push(row);
  }
  return picked;
}

export function pickFirstTriageCandidates(
  queue: TriageQueueRow[],
  goal: OnboardingGoal | null = null,
): TriageQueueRow[] {
  const eligible = queue.filter((r) => r.verdict !== 'keep' && r.protectionReason === null);

  if (goal === 'protect_important') {
    // Not a cleanup goal — nothing moves, so the payoff gate does not
    // apply. Rank by evidence of a real relationship.
    const ranked = [...queue].sort(
      compareBy(
        (row) => (row.verdict === 'keep' || row.protectionReason !== null ? 0 : 1),
        mostReadFirst,
        (row) => row.lastDays,
        (row) => -row.confidence,
        (row) => row.senderKey,
      ),
    );
    // NO brand thinning here. That rule assumes a row is an
    // organisation's mail stream, which is true for cleanup — twelve
    // `zerodha.net` addresses really are one sender to a user. It is
    // false for this goal, where a row is a PERSON: correspondents live
    // on shared consumer domains, so the registrable domain is the mail
    // provider, not the identity. One real mailbox has 260 keep/protected
    // senders on `gmail.com` alone; thinning would show one of them and
    // hide 259. On a screen whose purpose is reviewing and CORRECTING
    // protection, a hidden row is a mistake the user can never reach.
    return ranked.slice(0, FIRST_TRIAGE_PINNED_COUNT);
  }

  const candidates = eligible.filter(worthOneDecision);

  if (goal === 'reduce_newsletters') {
    const ranked = [...candidates].sort(
      compareBy(
        (row) => (row.unsubscribeMethod !== 'none' ? 0 : 1),
        (row) => (row.verdict === 'unsubscribe' ? 0 : 1),
        (row) => -row.last90dMessages,
        leastReadFirst,
        (row) => -row.inboxCount,
        (row) => -row.confidence,
        (row) => row.senderKey,
      ),
    );
    return pickTopDistinctBrands(ranked);
  }

  if (goal === 'clear_old_promotions') {
    const ranked = [...candidates].sort(
      compareBy(
        (row) => (row.gmailCategory === 'promotions' ? 0 : 1),
        (row) => -row.inboxCount,
        leastReadFirst,
        (row) => -row.confidence,
        (row) => row.senderKey,
      ),
    );
    return pickTopDistinctBrands(ranked);
  }

  // No goal recorded (the step was skipped). Lead with the biggest
  // reclaim available, since nothing narrower is known about intent.
  const ranked = [...candidates].sort(
    compareBy(
      (row) => -row.inboxCount,
      leastReadFirst,
      (row) => -row.confidence,
      (row) => row.senderKey,
    ),
  );
  return pickTopDistinctBrands(ranked);
}

/**
 * The only gate, and it is definitional rather than tuned.
 *
 * 1. The action must move mail that is in the inbox NOW. A row whose
 *    Archive would move nothing is not a decision, it is a no-op with a
 *    button. `totalAllTime` cannot serve here: it counts indexed mail
 *    including everything already archived, so a sender with ten filed
 *    messages and an empty inbox passes a `>= 10` test and still moves
 *    zero.
 * 2. `later` is excluded. Its rule id is `insufficient_signal` and its
 *    user string is "not enough signal yet" — the engine saying it has
 *    no opinion. Leading a first run with five of those is how the
 *    screen came to show five one-message senders: `later` carries a
 *    flat 0.70 confidence, real scoring produces roughly 0.5 + 0.35 x
 *    strength, and `clear_old_promotions` ranked both in one bucket by
 *    confidence, so thin data won.
 *
 * Nothing else filters. Cadence and volume are RANKING terms; gating on
 * them is how the previous `>= 10 received or >= 3 recent` cutoffs got
 * invented, and neither number was derived from anything.
 */
function worthOneDecision(row: TriageQueueRow): boolean {
  return row.inboxCount > 0 && row.verdict !== 'later';
}

/**
 * Ascending "least-read first". Unknown sorts LAST: a sender with no
 * mail in the window has no read rate, and treating that absence as
 * 0.00 makes silence indistinguishable from "sends constantly, never
 * opened" — the best possible score under this ordering.
 */
function leastReadFirst(row: TriageQueueRow): number {
  return row.readRate ?? 2;
}

/** Ascending "most-read first". Unknown sorts LAST, same reasoning. */
function mostReadFirst(row: TriageQueueRow): number {
  return row.readRate === null ? 2 : -row.readRate;
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
