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
 *      confidence > threshold (default 0.85). Threshold-bearing; the
 *      Autopilot UI exposes a slider per D101.
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
 * computed by the deterministic cascade in `score-cascade.ts`.
 *
 * D7 / D228: every signal a matcher reads is metadata. No body
 * content, no attachments, no non-allowlisted headers.
 */

/**
 * The signal subset Autopilot presets read. A minimal projection of
 * `SenderSignals` — the worker materializes only these fields rather
 * than the full cascade signal set, since presets do not need the
 * engagement-cascade fields (`hasReplied`, `gmailCategory`,
 * `starredInLastYear`, `spikeRatio`, ...).
 */
export interface PresetSignals {
  /** Used by the worker to filter protected senders BEFORE matching. */
  isProtected: boolean;
  /** D101 #3: sender age in days. `< 7` matches. */
  firstSeenDaysAgo: number;
  /** D101 #3: total messages ever seen. `< 3` matches. */
  totalMessages: number;
  /** D101 #4, #5: read rate over the last 90 days, `[0, 1]`. */
  readRate90d: number;
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
    defaultThreshold: 0.85,
    defaultActionPayload: {},
    dailyActionCap: 100,
    match: VERDICT_MATCHER('archive', 0.85, 'Archive'),
  },
  auto_unsubscribe_noisy: {
    defaultName: 'Auto-unsubscribe noisy senders',
    actionKind: 'unsubscribe',
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
      if (signals.readRate90d >= 0.05) return { matched: false, reason: '' };
      if (signals.lastSeenDaysAgo <= 90) return { matched: false, reason: '' };
      if (signals.lastSeenDaysAgo > 180) return { matched: false, reason: '' };
      return {
        matched: true,
        reason: `Read rate ${pctOf(signals.readRate90d)}%, last seen ${signals.lastSeenDaysAgo}d ago`,
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
      if (signals.readRate90d >= 0.05) return { matched: false, reason: '' };
      if (signals.lastSeenDaysAgo <= 180) return { matched: false, reason: '' };
      return {
        matched: true,
        reason: `Read rate ${pctOf(signals.readRate90d)}%, last seen ${signals.lastSeenDaysAgo}d ago`,
      };
    },
  },
};
