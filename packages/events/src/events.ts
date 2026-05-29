import { z } from 'zod';

import { TOPICS, type EventTopic } from './topics.js';

/**
 * D204 — typed Zod schemas for every cross-feature event the outbox
 * dispatcher (D13) routes.
 *
 * Each schema is `.strict()` so unknown keys are rejected at parse
 * time — that's what makes the contract a *gate* rather than a
 * suggestion. Publishers pass the corresponding schema to
 * `OutboxPublisher.publish({schema})`; the publisher runs
 * `schema.parse(payload)` and a PII-key denylist before insert
 * (defense-in-depth per D7 / D228).
 *
 * Privacy (D7, D228): every payload below carries metadata only —
 * mailbox/sender/message identifiers, enum verdicts, numeric counts,
 * ISO-8601 timestamps. NO body, NO snippet, NO subject, NO
 * non-allowlisted header. The OutboxPublisher's runtime denylist
 * additionally rejects `subject` / `snippet` / `body` / `htmlBody` /
 * `rawMime` / `headers` keys even if a future schema bug let them
 * through.
 *
 * Append-only — adding a new field to an existing schema is OK
 * (consumers must tolerate unknown fields, but `.strict()` means a
 * publisher with an outdated schema will fail validation, signaling
 * the drift). RENAMING or REMOVING a field is a breaking change —
 * write a new event topic instead.
 */

/** sha256("v1|" + normalized_email), hex — matches `senders.sender_key` shape. */
const SenderKeySchema = z.string().regex(/^[0-9a-f]{64}$/, 'sender_key must be sha256 hex');

/** UUID v4 — mailbox / undo token / rule / match ids. */
const UuidSchema = z.string().uuid();

/** K/A/U/L canonical verbs per D227. */
const VerdictSchema = z.enum(['keep', 'archive', 'unsubscribe', 'later']);

/** Numeric confidence in [0, 1], 2-dp precision. */
const ConfidenceSchema = z.number().min(0).max(1);

// ──────────────────────────────────────────────────────────────────────
// triage.score_run_completed
// ──────────────────────────────────────────────────────────────────────

/**
 * Emitted by the score worker after a per-mailbox sweep finishes
 * (`ScoreTrigger='sync_complete' | 'cron_sweep'`). Drives the
 * AutopilotApplyWorker — the apply worker subscribes here and runs
 * preset matchers against the current `triage_decisions` rows.
 */
export const TriageScoreRunCompletedPayloadSchema = z
  .object({
    mailboxAccountId: UuidSchema,
    /** Trigger source that started the score run — observability + dedup. */
    trigger: z.enum(['sync_complete', 'cron_sweep', 'manual_rescore', 'signal_change']),
    /** Run wall clock (ms since epoch) — matches the score worker's `producedAtMs`. */
    producedAtMs: z.number().int().nonnegative(),
    /** How many senders the run scored (metric). */
    decisionsWritten: z.number().int().nonnegative(),
  })
  .strict();
export type TriageScoreRunCompletedPayload = z.infer<typeof TriageScoreRunCompletedPayloadSchema>;

// ──────────────────────────────────────────────────────────────────────
// triage.decision_recomputed
// ──────────────────────────────────────────────────────────────────────

/**
 * Emitted by the score worker when a single sender's decision row was
 * upserted (`ScoreTrigger='manual_rescore' | 'signal_change'`).
 * Finer-grained than `score_run_completed`; consumers that only care
 * about one sender at a time (e.g. a future Autopilot
 * apply-on-change variant) subscribe here.
 */
export const TriageDecisionRecomputedPayloadSchema = z
  .object({
    mailboxAccountId: UuidSchema,
    senderKey: SenderKeySchema,
    verdict: VerdictSchema,
    confidence: ConfidenceSchema,
    producedAtMs: z.number().int().nonnegative(),
    /** Provenance — was the reasoning text LLM or template? D24. */
    generatedBy: z.enum(['llm_haiku', 'template']),
  })
  .strict();
export type TriageDecisionRecomputedPayload = z.infer<typeof TriageDecisionRecomputedPayloadSchema>;

// ──────────────────────────────────────────────────────────────────────
// triage.verdict_applied
// ──────────────────────────────────────────────────────────────────────

/**
 * Emitted when a user-triggered K/A/U/L action takes effect on a
 * sender (D34, D226). Distinct from `decision_recomputed`: this is
 * the user's verdict, not the engine's. Carries the undo token so
 * activity log + audit consumers can join back.
 */
export const TriageVerdictAppliedPayloadSchema = z
  .object({
    mailboxAccountId: UuidSchema,
    senderKey: SenderKeySchema,
    verdict: VerdictSchema,
    /** D34 source — how the user reached the action. */
    source: z.enum(['triage', 'manual', 'autopilot', 'screener']),
    /** Issued by `undo_journal` for the K/A/U action; null for Keep (no-op to undo). */
    undoToken: UuidSchema.nullable(),
    /** Messages the verdict moved — drives the audit "47 emails" count. */
    affectedCount: z.number().int().nonnegative(),
  })
  .strict();
export type TriageVerdictAppliedPayload = z.infer<typeof TriageVerdictAppliedPayloadSchema>;

// ──────────────────────────────────────────────────────────────────────
// actions.label_action_applied
// ──────────────────────────────────────────────────────────────────────

/**
 * Emitted by the action-consumer worker after a label-modify verb (D226)
 * commits. Generic over the selector — `senderKey` is present for a
 * sender-scoped action, null for a message-scoped one (which may span
 * senders). Carries the action job id + the issued undo token so audit
 * consumers can join back to `action_jobs` and `undo_journal`.
 */
export const ActionLabelAppliedPayloadSchema = z
  .object({
    mailboxAccountId: UuidSchema,
    /** `action_jobs.id` — the aggregate this event is about. */
    actionId: UuidSchema,
    /** Label-modify verb that applied. */
    verb: z.enum(['archive']),
    /** Present for a sender selector; null for a message selector. */
    senderKey: SenderKeySchema.nullable(),
    /** Undo token issued for this action (always set — archive is undoable). */
    undoToken: UuidSchema,
    /** Messages the action moved. */
    affectedCount: z.number().int().nonnegative(),
  })
  .strict();
export type ActionLabelAppliedPayload = z.infer<typeof ActionLabelAppliedPayloadSchema>;

// ──────────────────────────────────────────────────────────────────────
// autopilot.match_recorded
// ──────────────────────────────────────────────────────────────────────

/**
 * Emitted by AutopilotApplyWorker when it writes a `rule_match_log`
 * row (D99, D104). Active-mode matches additionally drive the action
 * consumer through `autopilot.action_intent_emitted`; Observe-mode
 * matches stop here.
 */
export const AutopilotMatchRecordedPayloadSchema = z
  .object({
    mailboxAccountId: UuidSchema,
    ruleId: UuidSchema,
    matchId: UuidSchema,
    senderKey: SenderKeySchema,
    /** Snapshot of rule mode at match time. */
    modeAtMatch: z.enum(['observe', 'active']),
    /** Confidence the engine had on the sender at match time. */
    confidence: ConfidenceSchema,
    /** Short label for which branch matched ("Engine verdict=Archive @0.92"). */
    reason: z.string().min(1).max(280),
  })
  .strict();
export type AutopilotMatchRecordedPayload = z.infer<typeof AutopilotMatchRecordedPayloadSchema>;

// ──────────────────────────────────────────────────────────────────────
// autopilot.action_intent_emitted
// ──────────────────────────────────────────────────────────────────────

/**
 * Emitted by the (future) action consumer worker after it transforms
 * an Active-mode Autopilot match into a Gmail mutation intent (D226
 * lifecycle). Marks the post-emission transition on the match row:
 * `intent_applied=true`, `intent_token=<undo_journal token>`.
 */
export const AutopilotActionIntentEmittedPayloadSchema = z
  .object({
    mailboxAccountId: UuidSchema,
    ruleId: UuidSchema,
    matchId: UuidSchema,
    senderKey: SenderKeySchema,
    /** K/A/U/L verb that's about to apply. 'keep' is never emitted (Autopilot doesn't fire on Keep). */
    actionKind: z.enum(['archive', 'unsubscribe', 'later']),
    /** Token in `undo_journal` that the action consumer just inserted. */
    undoToken: UuidSchema,
  })
  .strict();
export type AutopilotActionIntentEmittedPayload = z.infer<
  typeof AutopilotActionIntentEmittedPayloadSchema
>;

// ──────────────────────────────────────────────────────────────────────
// followup.dismissed
// ──────────────────────────────────────────────────────────────────────

/**
 * Emitted by FollowupReadService.dismiss after the status flip +
 * activity_log entry land (D88). The activity log is the primary
 * audit trail; this event is reserved for cross-feature analytics
 * consumers (e.g. a "follow-ups resolved this week" rollup) that
 * don't want to project from `activity_log` directly.
 */
export const FollowupDismissedPayloadSchema = z
  .object({
    mailboxAccountId: UuidSchema,
    followupId: UuidSchema,
    /** Gmail thread id the followup was tracking — for downstream joins. */
    providerThreadId: z.string().min(1),
  })
  .strict();
export type FollowupDismissedPayload = z.infer<typeof FollowupDismissedPayloadSchema>;

// ──────────────────────────────────────────────────────────────────────
// mailbox.sync_ready
// ──────────────────────────────────────────────────────────────────────

/**
 * Emitted when initial sync (D6 strict gate) reaches `ready`.
 * Consumers: AutopilotPresetSeeder (seeds the 5 D101 presets) +
 * future onboarding-state machine.
 */
export const MailboxSyncReadyPayloadSchema = z
  .object({
    mailboxAccountId: UuidSchema,
    workspaceId: UuidSchema,
    /** ISO-8601 — when the sync stage transitioned to ready. */
    readyAt: z.string().datetime(),
    /** Total messages the initial sync mirrored (metric). */
    messageCount: z.number().int().nonnegative(),
  })
  .strict();
export type MailboxSyncReadyPayload = z.infer<typeof MailboxSyncReadyPayloadSchema>;

// ──────────────────────────────────────────────────────────────────────
// mailbox.deleted
// ──────────────────────────────────────────────────────────────────────

/**
 * Emitted by the (future) D232 hard-delete cron after a mailbox row +
 * all cascade children have been removed. Consumers: per-mailbox
 * cache evictions (e.g. the rate limiter's
 * `limiterByMailbox: Map<id, RateLimiter>`).
 */
export const MailboxDeletedPayloadSchema = z
  .object({
    mailboxAccountId: UuidSchema,
    workspaceId: UuidSchema,
    /** D232 basis — was the deletion driven by undo-window expiry or a typed waiver? */
    basis: z.enum(['undo-window', 'waiver', 'standard-30d']),
    /** ISO-8601 — when the hard delete completed. */
    deletedAt: z.string().datetime(),
  })
  .strict();
export type MailboxDeletedPayload = z.infer<typeof MailboxDeletedPayloadSchema>;

// ──────────────────────────────────────────────────────────────────────
// Topic ↔ payload map — typed lookup for publishers + dispatcher
// ──────────────────────────────────────────────────────────────────────

/**
 * Maps each topic constant to its payload type. Publishers can spell
 * this as `EventPayloadByTopic[typeof TOPICS.TRIAGE_SCORE_RUN_COMPLETED]`
 * to get the right type without hand-rolling per-call generics.
 *
 * Exhaustive — `satisfies Record<EventTopic, z.ZodSchema>` means a
 * new topic constant added to TOPICS without a schema entry here is
 * a compile error, not a silent runtime gap.
 */
export const EVENT_SCHEMAS = {
  [TOPICS.TRIAGE_SCORE_RUN_COMPLETED]: TriageScoreRunCompletedPayloadSchema,
  [TOPICS.TRIAGE_DECISION_RECOMPUTED]: TriageDecisionRecomputedPayloadSchema,
  [TOPICS.TRIAGE_VERDICT_APPLIED]: TriageVerdictAppliedPayloadSchema,
  [TOPICS.ACTION_LABEL_APPLIED]: ActionLabelAppliedPayloadSchema,
  [TOPICS.AUTOPILOT_MATCH_RECORDED]: AutopilotMatchRecordedPayloadSchema,
  [TOPICS.AUTOPILOT_ACTION_INTENT_EMITTED]: AutopilotActionIntentEmittedPayloadSchema,
  [TOPICS.FOLLOWUP_DISMISSED]: FollowupDismissedPayloadSchema,
  [TOPICS.MAILBOX_SYNC_READY]: MailboxSyncReadyPayloadSchema,
  [TOPICS.MAILBOX_DELETED]: MailboxDeletedPayloadSchema,
} as const satisfies Record<EventTopic, z.ZodSchema>;

/**
 * Map from topic literal → payload type. The `z.infer` form on each
 * value pulls the parsed type, so callers get full TS narrowing.
 */
export type EventPayloadByTopic = {
  [TOPICS.TRIAGE_SCORE_RUN_COMPLETED]: TriageScoreRunCompletedPayload;
  [TOPICS.TRIAGE_DECISION_RECOMPUTED]: TriageDecisionRecomputedPayload;
  [TOPICS.TRIAGE_VERDICT_APPLIED]: TriageVerdictAppliedPayload;
  [TOPICS.ACTION_LABEL_APPLIED]: ActionLabelAppliedPayload;
  [TOPICS.AUTOPILOT_MATCH_RECORDED]: AutopilotMatchRecordedPayload;
  [TOPICS.AUTOPILOT_ACTION_INTENT_EMITTED]: AutopilotActionIntentEmittedPayload;
  [TOPICS.FOLLOWUP_DISMISSED]: FollowupDismissedPayload;
  [TOPICS.MAILBOX_SYNC_READY]: MailboxSyncReadyPayload;
  [TOPICS.MAILBOX_DELETED]: MailboxDeletedPayload;
};
