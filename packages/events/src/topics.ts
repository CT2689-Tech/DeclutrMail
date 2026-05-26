/**
 * D204 — cross-feature event topic constants.
 *
 * The outbox dispatcher (D13) routes events on `topic`. D204 mandates
 * the `{feature}.{noun}_{past_participle}` shape so the topic itself
 * communicates intent ("autopilot.match_recorded", not "autopilot_match").
 * Centralizing the strings here gives:
 *
 *   - Compile-time autocomplete instead of stringly-typed magic.
 *   - A single grep target ("who emits / consumes topic X?").
 *   - A typed map (`EventPayloadByTopic`) so a publisher that hands
 *     `topic = TRIAGE_SCORE_RUN_COMPLETED` is statically forced to use
 *     `TriageScoreRunCompletedPayload`.
 *
 * Topics are append-only — never repurpose an existing name. The
 * outbox dispatcher persists rows forever for audit; renaming would
 * orphan historical rows from their consumer.
 *
 * Privacy (D7, D228): topic strings carry no message content. The
 * payload schemas (see `events.ts`) are the privacy contract; the
 * OutboxPublisher additionally enforces a PII-key denylist as
 * defense-in-depth.
 */

export const TOPICS = {
  /**
   * Score worker (D20, D21) finished a per-mailbox sweep. Drives the
   * AutopilotApplyWorker — the apply worker subscribes here, loads
   * enabled rules, and runs the preset matchers against current
   * `triage_decisions` rows.
   */
  TRIAGE_SCORE_RUN_COMPLETED: 'triage.score_run_completed',

  /**
   * Score worker upserted one sender's decision row (manual rescore
   * or signal-change trigger). Finer-grained than the run-completed
   * sweep event; reserved for future per-sender consumers (e.g. an
   * Autopilot apply-on-decision-change variant).
   */
  TRIAGE_DECISION_RECOMPUTED: 'triage.decision_recomputed',

  /**
   * User-triggered K/A/U/L action took effect on a sender (D34,
   * D226). Carries the action lifecycle's terminal state plus the
   * undo token. Consumers: activity log projector, audit pipelines.
   */
  TRIAGE_VERDICT_APPLIED: 'triage.verdict_applied',

  /**
   * AutopilotApplyWorker (D99, D104) wrote a `rule_match_log` row.
   * Active-mode matches set `intent_applied=false`; the future action
   * consumer subscribes here to read those and emit the Gmail
   * mutation through the existing undo-journal path.
   */
  AUTOPILOT_MATCH_RECORDED: 'autopilot.match_recorded',

  /**
   * Action consumer emitted a Gmail mutation intent into the undo
   * journal on behalf of an Autopilot Active-mode match. Distinct
   * from `match_recorded` because the match log row is written
   * before the action fires; this event marks the post-emission
   * transition (`intent_applied=true`, `intent_token=<uuid>`).
   */
  AUTOPILOT_ACTION_INTENT_EMITTED: 'autopilot.action_intent_emitted',

  /**
   * User clicked "Mark resolved" on a followup row (D88). Carries
   * the followup id and the mailbox. Activity-log projection lives
   * inside FollowupReadService.dismiss for now (single-tx with the
   * status flip); this event is reserved for cross-feature consumers
   * (e.g. a future "followup-resolved" analytics rollup).
   */
  FOLLOWUP_DISMISSED: 'followup.dismissed',

  /**
   * New mailbox completed initial sync (D6 strict gate reached
   * ready). Consumers: AutopilotPresetSeeder (seeds the 5 D101
   * presets); future onboarding-state machine.
   */
  MAILBOX_SYNC_READY: 'mailbox.sync_ready',

  /**
   * Mailbox was deleted (D232 hard-delete path completed). Consumers:
   * per-mailbox cache evictions (e.g. the worker's
   * `limiterByMailbox: Map<id, RateLimiter>` — FOUNDER-FOLLOWUPS
   * 2026-05-22 "limiter cache eviction tied to D232").
   */
  MAILBOX_DELETED: 'mailbox.deleted',
} as const;

/** Closed string-literal union of every D204 topic. */
export type EventTopic = (typeof TOPICS)[keyof typeof TOPICS];

/** Runtime guard — narrows an unknown string to a known topic. */
export function isEventTopic(value: unknown): value is EventTopic {
  if (typeof value !== 'string') return false;
  return (Object.values(TOPICS) as string[]).includes(value);
}
