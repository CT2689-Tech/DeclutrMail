import type {
  AutopilotActionKind,
  AutopilotMatchMode,
  AutopilotMatchResolution,
  AutopilotPresetKey,
  AutopilotRuleMode,
  AutopilotRuleScope,
} from '@declutrmail/db';

/**
 * Wire types for the Autopilot HTTP surface (D99-D105, D124).
 *
 * Mirrors `automation_rules` and `rule_match_log` rows in their
 * external-facing form: ISO strings instead of Date, parsed floats
 * instead of `numeric(3,2)` strings, no internal-only fields. The
 * `AutopilotReadService` is the only place that translates between
 * the DB rows and these types.
 */

/** One Autopilot rule, as the read service returns it. */
export interface AutopilotRule {
  id: string;
  /**
   * System preset identifier. NULL for custom rules. At V2 launch the
   * API never returns a custom rule (`is_preset=false`) because the
   * custom builder UI is flag-disabled per D197, but the wire shape is
   * forward-compatible.
   */
  presetKey: AutopilotPresetKey | null;
  isPreset: boolean;
  name: string;
  enabled: boolean;
  mode: AutopilotRuleMode;
  modeChangedAt: string;
  /** Null when the preset does not gate on confidence. */
  confidenceThreshold: number | null;
  scope: AutopilotRuleScope;
  actionKind: AutopilotActionKind;
  actionPayload: Record<string, unknown>;
  lastRunAt: string | null;
  lastRunActions: number;
  lastRunSenders: number;
  createdAt: string;
  updatedAt: string;
}

/** Allowed `PATCH /autopilot/rules/:id` body. All fields optional. */
export interface AutopilotRulePatch {
  /** D34 / D101 — toggle the rule on / off. */
  enabled?: boolean;
  /** D101 / D105 — observe ↔ active ↔ paused. */
  mode?: AutopilotRuleMode;
  /**
   * D101 threshold slider. Range `[0, 1]`. Only meaningful for
   * threshold-bearing presets (#1, #2); the API accepts a value on
   * any rule but the matcher ignores it for non-threshold presets.
   * `null` resets to the preset's default at runtime.
   */
  confidenceThreshold?: number | null;
  /** D102 — per-inbox vs all-inboxes. */
  scope?: AutopilotRuleScope;
}

/** One match row, as the pending-suggestions endpoint returns it. */
export interface AutopilotMatch {
  id: string;
  ruleId: string;
  /** The matched sender (sha256 hex — never the raw email). */
  senderKey: string;
  /** ISO-8601. */
  matchedAt: string;
  modeAtMatch: AutopilotMatchMode;
  /** Engine confidence at match time, parsed from `numeric(3,2)`. */
  confidence: number;
  reason: string;
  resolution: AutopilotMatchResolution;
  intentApplied: boolean;
  /** Set once the action consumer emits the action. */
  intentToken: string | null;
  resolvedAt: string | null;
}

/** Outcome of `POST /autopilot/pause-all` (D105). */
export interface AutopilotPauseAllResult {
  /** Number of rules that flipped from `observe`/`active` to `paused`. */
  pausedCount: number;
}

/** Outcome of `POST /autopilot/matches/:id/dismiss` (D104). */
export interface AutopilotMatchDismissResult {
  /** The match's terminal resolution after this call. Always `'dismissed'` on 200. */
  resolution: AutopilotMatchResolution;
  resolvedAt: string;
  /**
   * Phase-1 idempotency hint (D202/D207): `true` when the match was
   * already in the `dismissed` terminal state — the request was a
   * no-op replay rather than the first dismiss. Lets a client retrying
   * a flaky network request render the success state without having
   * to disambiguate from a 404 "match not found". Phase-2 lands the
   * full `Idempotency-Key` table; until then this hint is the contract.
   */
  alreadyDismissed: boolean;
}
