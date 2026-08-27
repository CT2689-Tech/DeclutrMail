import type { AutopilotActionKind, AutopilotPresetKey, TriageVerdict } from '@declutrmail/db';

/**
 * Autopilot preset matchers — pure functions (D99, D100, D101, D124).
 *
 * Each preset takes a `PresetInput` (engine signals + current triage
 * decision) and an optional `threshold`, returning a `PresetMatchResult`
 * with `{matched, reason}`. The runtime worker calls these for every
 * (rule, sender) pair; this module is pure so the matcher tests run
 * against fixtures with no DB and no clock.
 *
 * The 5 V2 presets per D101 + D124's patch:
 *
 *   1. `auto_archive_low_engagement`   — Engine verdict=Archive AND
 *      confidence > threshold (default 0.72 — D101 said 0.85, which the
 *      cascade cannot reach for Archive; see the preset body and
 *      migration 0067). Threshold-bearing; the Autopilot UI exposes a
 *      slider per D101.
 *
 *   2. `auto_unsubscribe_noisy`        — Engine verdict=Unsubscribe
 *      AND confidence > threshold (default 0.90). Threshold-bearing.
 *
 *   3. `auto_screen_new_senders`       — Sender age < 7 days OR total
 *      messages < 3. Action: `'later'` per D227 (the Screen verdict's
 *      canonical store value).
 *
 *   4. `newsletter_graveyard`          — Read rate < 5% AND last seen
 *      > 90 days. Action: unsubscribe.
 *
 *   5. `long_dormant_unsubscribe`      — Read rate < 5% AND last seen
 *      > 180 days. Action: unsubscribe. D124 replaces preset #5 (was
 *      manual safety-based Brief priority) with this — Brief priority is
 *      hard-coded engine behavior, not a user-toggleable rule.
 *
 * Protected senders (`signals.isProtected = true`) are filtered out by
 * the worker BEFORE the matchers run, so matchers do not re-check
 * protection. This keeps the matchers focused on the rule's own
 * condition vocabulary and avoids hiding the protection filter in
 * scattered places.
 *
 * D222: no category prediction. Matchers reference engine signals
 * (verdict + confidence + age + read rate + last seen + total
 * messages) — never an ML-predicted category. The engine's verdict is
 * computed by the deterministic cascade in `packages/shared/src/triage-engine/cascade.ts`.
 *
 * D7 / D228: every signal a matcher reads is metadata. No body
 * content, no attachments, no non-allowlisted headers.
 */

/**
 * Minimum lifetime messages before a dormancy preset will act.
 *
 * A read rate over one or two messages is noise, and both presets that
 * read it end in an unsubscribe. Five is the floor the 59-sender
 * qualifier was measured against on the founder's mailbox.
 */
export const DORMANCY_MIN_MESSAGES = 5;

/**
 * The signal subset Autopilot presets read. A minimal projection of
 * `SenderSignals` — the worker materializes only these fields rather
 * than the full cascade signal set, since presets do not need the
 * engagement-cascade fields (`hasWrittenTo`, `gmailCategory`,
 * `starredInLastYear`, `spikeRatio`, ...).
 */
export interface PresetSignals {
  /** Used by the worker to filter protected senders BEFORE matching. */
  isProtected: boolean;
  /** D101 #3: sender age in days. `< 7` matches. */
  firstSeenDaysAgo: number;
  /** D101 #3: total messages ever seen. `< 3` matches. */
  totalMessages: number;
  /**
   * Read rate over ALL of this sender's mail, `[0, 1]`.
   *
   * LIFETIME, not a rolling window, and that is the whole point. The
   * dormancy presets below require `lastSeenDaysAgo > 90`, which
   * guarantees a sender has no mail inside a 90-day window — so a
   * 90-day rate was structurally unmeasurable for exactly the senders
   * that needed it. While it was fabricated as `0` the accompanying
   * `< 0.05` test could not fail: it filtered nothing, and 6,531 dormant
   * senders read as "Read rate 0%", including ones the user reads almost
   * every message from. Abstaining on `null` fixed the lie and left both
   * presets matching nothing; measuring over the sender's OWN mail is
   * what re-arms them.
   *
   * DECONTAMINATED (mig 0064, F012). The numerator excludes messages a
   * third-party sweeper marked read, because a sweeper only ever marks
   * READ — it inflates the rate and would suppress exactly the matches
   * these presets exist to find. Measured on the founder's mailbox:
   * 59 matches decontaminated vs 24 without. The gap is 35 genuinely
   * ignored senders that sweeper marks were disguising as engaged.
   *
   * `null` = unmeasurable (we hold no mail from this sender), NEVER
   * "never read".
   */
  readRateLifetime: number | null;
  /** D101 #4 (`> 90`), #5 (`> 180`): days since `last_seen_at`. */
  lastSeenDaysAgo: number;
}

/** What the matcher sees: signals + the engine's current triage decision. */
export interface PresetInput {
  signals: PresetSignals;
  /**
   * Engine's current decision for this sender. `null` when no triage
   * decision row exists yet (the score worker hasn't run). Presets
   * that gate on verdict + confidence (#1, #2) treat `null` as
   * non-matching.
   */
  triageDecision: { verdict: TriageVerdict; confidence: number } | null;
}

/** Outcome of one matcher invocation. */
export interface PresetMatchResult {
  /** Whether the preset's conditions are met for this input. */
  matched: boolean;
  /**
   * Human-readable label describing which branch matched. Empty string
   * when `matched=false`. Surfaces in `rule_match_log.reason` and the
   * pending-suggestion UI card per D101.
   */
  reason: string;
}

/** One preset's static definition: action emitted + default threshold + matcher. */
export interface PresetDefinition {
  /**
   * V2 launch UI label per D101. Used as the default `name` when the
   * preset row is seeded (`automation_rules.name`). Users may rename
   * via the Autopilot screen.
   */
  defaultName: string;
  /** K/A/U/L verb the rule emits per D227. */
  actionKind: AutopilotActionKind;
  /**
   * Default confidence floor; `null` when the preset does not gate on
   * engine confidence. Threshold-bearing presets (#1, #2) expose a
   * slider in the Autopilot UI.
   */
  defaultThreshold: number | null;
  /**
   * Action modifiers (D101 #2 sets `{and_archive_future: true}`).
   * Serialized into `automation_rules.action_payload`.
   */
  defaultActionPayload: Record<string, unknown>;
  /**
   * Max ACTIONS this rule may execute per rolling 24h window (U14 —
   * D99 blast-radius guard). Enforced by `AutopilotActionWorker`
   * against `activity_log` rows where `source='autopilot'` AND
   * `rule_id = <rule>`; matches beyond the cap stay
   * `intent_applied=false` and execute on a later sweep. Bounds the
   * damage of a runaway rule (bad threshold, engine regression) to one
   * day's cap rather than the whole mailbox.
   */
  dailyActionCap: number;
  /** The matcher fn — pure, no side effects. */
  match: (input: PresetInput, threshold: number | null) => PresetMatchResult;
}

/**
 * Round a probability to a 2-dp string, matching the engine's
 * `numeric(3,2)` storage precision. Display-only — the comparison itself
 * uses the float value.
 */
function fmtConf(c: number): string {
  return c.toFixed(2);
}

/** Round a `[0, 1]` rate to a whole-percent integer for UI display. */
function pctOf(rate: number): number {
  return Math.round(rate * 100);
}

const VERDICT_MATCHER =
  (
    targetVerdict: TriageVerdict,
    defaultThreshold: number,
    targetVerdictLabel: string,
  ): PresetDefinition['match'] =>
  ({ triageDecision }, threshold) => {
    if (!triageDecision) return { matched: false, reason: '' };
    if (triageDecision.verdict !== targetVerdict) return { matched: false, reason: '' };
    const t = threshold ?? defaultThreshold;
    // Strict `>` per D101's "confidence > 0.85" wording. A sender at
    // exactly the threshold does NOT match — the user's slider value
    // is interpreted as "above this".
    if (triageDecision.confidence <= t) return { matched: false, reason: '' };
    return {
      matched: true,
      reason: `Engine verdict=${targetVerdictLabel} @${fmtConf(triageDecision.confidence)} above threshold ${fmtConf(t)}`,
    };
  };

export const AUTOPILOT_PRESETS: Record<AutopilotPresetKey, PresetDefinition> = {
  auto_archive_low_engagement: {
    defaultName: 'Auto-archive low-engagement',
    actionKind: 'archive',
    // 0.72, not D101's 0.85. The cascade can only reach Archive in
    // [0.73, 0.88], and everything above 0.85 there requires the
    // `+0.30 userManuallyArchivedCount >= 3` term — so at 0.85 this
    // preset could only ever fire for senders the user had already
    // archived three times by hand. It swept the founder's mailbox once
    // and took 0 actions while the other two presets took 172 and 51.
    // The gate was sized for the pre-2026-07-02 confidence
    // distribution and never re-anchored when that distribution moved.
    // Migration 0067 carries existing rows; this is the value new
    // mailboxes seed with. Same floor Triage uses for its Recommended
    // hint (`@declutrmail/shared/copy/engine-confidence`), so the
    // automation and the screen agree on what "confident" means.
    defaultThreshold: 0.72,
    defaultActionPayload: {},
    dailyActionCap: 100,
    match: VERDICT_MATCHER('archive', 0.72, 'Archive'),
  },
  auto_unsubscribe_noisy: {
    defaultName: 'Auto-unsubscribe noisy senders',
    actionKind: 'unsubscribe',
    // 0.90 STAYS, deliberately — do not "fix" this to match the
    // re-anchored Archive preset above.
    //
    // It has the same provenance as the Archive gate: the 2026-07-02
    // re-weight lowered every confidence and this threshold did not
    // move, so its reach fell with it. Measured on the founder's
    // mailbox, over 97 post-re-weight Unsubscribe verdicts: 4 clear
    // 0.90, 28 clear 0.85, 31 clear 0.80. Pre-re-weight, 51 of 160
    // (32%) cleared 0.90 — so the rule reaches roughly a seventh of
    // what it was tuned for.
    //
    // Founder decision 2026-08-20 (option 2B): keep 0.90 anyway.
    // Unsubscribe is the one verb the product cannot take back, and
    // erring conservative on it is a deliberate product stance until
    // real users have run the rule. The Archive gate was re-anchored
    // because it was UNREACHABLE; this one is merely strict, and
    // strict is a choice. Revisit with usage data, not with symmetry.
    defaultThreshold: 0.9,
    // D101 #2: "Unsubscribe + auto-archive future".
    defaultActionPayload: { and_archive_future: true },
    dailyActionCap: 25,
    match: VERDICT_MATCHER('unsubscribe', 0.9, 'Unsubscribe'),
  },
  auto_screen_new_senders: {
    defaultName: 'Auto-screen new senders',
    actionKind: 'later',
    defaultThreshold: null,
    defaultActionPayload: {},
    dailyActionCap: 50,
    match: ({ signals }) => {
      const newByDays = signals.firstSeenDaysAgo < 7;
      const newByCount = signals.totalMessages < 3;
      if (!newByDays && !newByCount) return { matched: false, reason: '' };
      if (newByDays && newByCount) {
        return {
          matched: true,
          reason: `New sender (${signals.firstSeenDaysAgo}d old, ${signals.totalMessages} msgs)`,
        };
      }
      return {
        matched: true,
        reason: newByDays
          ? `New sender (${signals.firstSeenDaysAgo}d old)`
          : `New sender (${signals.totalMessages} msgs)`,
      };
    },
  },
  /**
   * Newsletter graveyard — recently dormant low-engagement senders.
   *
   * Bounded to the (90, 180] day window per Codex review of PR #65
   * (finding #2): the prior `lastSeenDaysAgo > 90` predicate overlapped
   * `long_dormant_unsubscribe`'s `> 180` predicate, so a sender at
   * 200d w/ low read rate fired BOTH presets and produced TWO
   * unsubscribe-match rows from a single sweep. The window is now
   * disjoint — this preset covers the first dormancy tier; the
   * long-dormant preset takes over past 180d.
   */
  newsletter_graveyard: {
    defaultName: 'Newsletter graveyard',
    actionKind: 'unsubscribe',
    defaultThreshold: null,
    defaultActionPayload: {},
    dailyActionCap: 25,
    match: ({ signals }) => {
      // Re-armed on a LIFETIME rate (F009/F012). The 90-day rate this
      // replaces could not be measured for any sender this preset can
      // reach — `lastSeenDaysAgo > 90` guarantees no mail in the window
      // — so its `< 0.05` test could never fail, and the abstain that
      // fixed the lie left the preset matching nothing at all.
      //
      // Still abstains on `null`: we hold no mail from this sender, and
      // "unmeasurable" must never become "never read" on a preset whose
      // action is an unsubscribe.
      if (signals.readRateLifetime === null) return { matched: false, reason: '' };
      // A rate over one or two messages is noise, and this ends in a
      // destructive verb. Five is the floor the qualifier was measured
      // against.
      if (signals.totalMessages < DORMANCY_MIN_MESSAGES) return { matched: false, reason: '' };
      if (signals.readRateLifetime >= 0.05) return { matched: false, reason: '' };
      if (signals.lastSeenDaysAgo <= 90) return { matched: false, reason: '' };
      if (signals.lastSeenDaysAgo > 180) return { matched: false, reason: '' };
      return {
        matched: true,
        reason:
          `Read rate ${pctOf(signals.readRateLifetime)}% across all ` +
          `${signals.totalMessages} messages, last seen ${signals.lastSeenDaysAgo}d ago`,
      };
    },
  },
  /**
   * Long-dormant unsubscribe — senders past the 180d threshold the
   * `newsletter_graveyard` preset stops at. Disjoint by construction.
   */
  long_dormant_unsubscribe: {
    defaultName: 'Long-dormant unsubscribe',
    actionKind: 'unsubscribe',
    defaultThreshold: null,
    defaultActionPayload: {},
    dailyActionCap: 25,
    match: ({ signals }) => {
      // Same lifetime rate and the same floors as `newsletter_graveyard`
      // — the two presets differ only in the dormancy tier they cover.
      if (signals.readRateLifetime === null) return { matched: false, reason: '' };
      if (signals.totalMessages < DORMANCY_MIN_MESSAGES) return { matched: false, reason: '' };
      if (signals.readRateLifetime >= 0.05) return { matched: false, reason: '' };
      if (signals.lastSeenDaysAgo <= 180) return { matched: false, reason: '' };
      return {
        matched: true,
        reason:
          `Read rate ${pctOf(signals.readRateLifetime)}% across all ` +
          `${signals.totalMessages} messages, last seen ${signals.lastSeenDaysAgo}d ago`,
      };
    },
  },
};
