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
    /**
     * Label-modify verb that applied. Mirrors the `action_verb` pg_enum
     * (archive + later + delete). `delete` joined per ADR-0019 + spec
     * v1.2 Decision 1 — Gmail TRASH is a label, so it rides the same
     * label-modify pipeline; the worker is the single producer.
     */
    verb: z.enum(['archive', 'later', 'delete']),
    /** Present for a sender selector; null for a message selector. */
    senderKey: SenderKeySchema.nullable(),
    /**
     * Undo token issued for this action. Set for the normal
     * (>0-message) label-modify path — archive/later/delete are all
     * undoable (delete via Gmail Trash recovery within 30d per
     * D81/D232). NULL on the terminal 0-message branch: nothing moved,
     * so there is nothing to reverse. The event still fires in that
     * case so downstream consumers (e.g. the Screener quarantine
     * resolver) learn the action reached terminal success.
     */
    undoToken: UuidSchema.nullable(),
    /** Messages the action moved. */
    affectedCount: z.number().int().nonnegative(),
    /**
     * Composite linkage (ADR-0020). For a composite secondary action
     * (e.g. the Delete part of "Later + Delete past"), this carries the
     * primary row's id so audit consumers can join siblings. Null for
     * single-verb actions and for the primary row of a composite.
     */
    compositeId: UuidSchema.nullable(),
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
// actions.unsubscribe_intent_recorded
// ──────────────────────────────────────────────────────────────────────

/**
 * Emitted by ActionsService.recordUnsubscribeIntent inside the same
 * transaction as the activity_log + action_jobs writes (D38; D204
 * boundary fix 2026-06-06). Per D204 the senders feature owns
 * `sender_policies` — ActionsService must NOT write that table
 * directly. Instead this event ships sender identification + the
 * captured intent timestamp; a senders-owned consumer
 * (SendersPolicyAttributionWorker) projects the policy upsert.
 *
 * The activity_log row is the durable audit trail (FE renders from
 * there); this event is the cross-feature signal.
 *
 * Privacy (D7, D228): metadata only — mailbox id + sender_key +
 * activity_log id + ISO timestamp. No sender email, no subject, no
 * snippet.
 */
export const ActionsUnsubscribeIntentRecordedPayloadSchema = z
  .object({
    mailboxAccountId: UuidSchema,
    senderKey: SenderKeySchema,
    /** FE-facing audit-row id — handle for cross-feature joins. */
    activityLogId: UuidSchema,
    /** ISO-8601 — when the activity_log row's `occurred_at` landed. */
    recordedAt: z.string().datetime(),
    /**
     * Sender's unsubscribe capability at intent time (D9 Wave 2,
     * additive). `one_click` ⇒ the consumer projects
     * `sender_policies.unsub_status = 'pending'` (an execution job is
     * in flight); `mailto` / `none` ⇒ no tracked execution (D230
     * manual path). Optional so events published before this field
     * existed still parse.
     */
    method: z.enum(['one_click', 'mailto', 'none']).optional(),
  })
  .strict();
export type ActionsUnsubscribeIntentRecordedPayload = z.infer<
  typeof ActionsUnsubscribeIntentRecordedPayloadSchema
>;

// ──────────────────────────────────────────────────────────────────────
// actions.unsubscribe_executed
// ──────────────────────────────────────────────────────────────────────

/**
 * Emitted by `UnsubExecutionWorker` inside the terminal transaction
 * of an RFC 8058 one-click unsubscribe attempt (D9 Wave 2). The
 * worker itself writes the durable effects (sender_policies.
 * unsub_status, the activity_log outcome row, the action_jobs
 * terminal state) — this event is the observability signal; no
 * consumer projection exists at this build.
 *
 * `outcome`:
 *   - `done`      — target answered 2xx.
 *   - `failed`    — target 4xx/5xx, blocked/invalid URL, or network
 *                   retries exhausted (`httpStatus` null then).
 *   - `ambiguous` — target answered 3xx; redirects are never
 *                   followed, so the result is unknown.
 *
 * Privacy (D7, D228): metadata only — ids, enum outcome, HTTP status
 * code. The target URL is deliberately NOT carried (it can embed
 * per-recipient tokens).
 */
export const ActionsUnsubscribeExecutedPayloadSchema = z
  .object({
    mailboxAccountId: UuidSchema,
    senderKey: SenderKeySchema,
    /** The execution's `action_jobs.id` — the FE poll handle. */
    actionId: UuidSchema,
    outcome: z.enum(['done', 'failed', 'ambiguous']),
    /** HTTP status from the target; null when the request never completed. */
    httpStatus: z.number().int().nullable(),
    /** ISO-8601 — when the terminal outcome was recorded. */
    executedAt: z.string().datetime(),
  })
  .strict();
export type ActionsUnsubscribeExecutedPayload = z.infer<
  typeof ActionsUnsubscribeExecutedPayloadSchema
>;

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
  [TOPICS.ACTIONS_UNSUBSCRIBE_INTENT_RECORDED]: ActionsUnsubscribeIntentRecordedPayloadSchema,
  [TOPICS.ACTIONS_UNSUBSCRIBE_EXECUTED]: ActionsUnsubscribeExecutedPayloadSchema,
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
  [TOPICS.ACTIONS_UNSUBSCRIBE_INTENT_RECORDED]: ActionsUnsubscribeIntentRecordedPayload;
  [TOPICS.ACTIONS_UNSUBSCRIBE_EXECUTED]: ActionsUnsubscribeExecutedPayload;
};
