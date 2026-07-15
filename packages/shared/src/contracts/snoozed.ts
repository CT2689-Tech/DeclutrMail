// @declutrmail/shared/contracts — Snoozed/Later surface (D78–D80).
//
// Wire contract for the Snoozed review screen:
//
//   GET   /api/snoozed              → Envelope<SnoozedSenderRow[]>
//   GET   /api/snoozed/recovery     → Envelope<LaterReturnRecoverySummary>
//   PATCH /api/snoozed/:senderId    → Envelope<SnoozeUpdateResult>
//   POST  /api/snoozed/:senderId/wake → Envelope<WakeNowResult>
//   POST  /api/snoozed/recovery/:senderId/wake → Envelope<WakeNowResult>
//
// Scope is SENDER-level only (D78) — there is no message-level snooze
// at launch. "Later" is the canonical user-facing verb (D227); the
// user-facing screen/feature name is "Later"; Snoozed remains only in
// internal API and implementation names.
//
// PRIVACY (D7, D228): rows carry sender display metadata (name, email,
// domain — all from the `senders` projection), counts, and timestamps.
// No subjects, no snippets, no body-adjacent content.

import { z } from 'zod';

/**
 * One sender on the Later screen. A sender is listed only while it has
 * an active Later timer. Its matching Gmail label mirror supplies the
 * real message count but does not create timerless rows (D245).
 */
export interface SnoozedSenderRow {
  /** `senders.id` — the selector for PATCH / wake. */
  senderId: string;
  /** Display name from the senders projection ('' when unknown). */
  displayName: string;
  email: string;
  domain: string;
  /**
   * Messages currently carrying the Later label for this sender, per
   * the local label mirror. `0` for a timer-only row. `null` when the
   * per-mailbox Later-label-id mapping has not been resolved yet (the
   * snooze-wake worker writes it on its first sweep; until then the
   * mirror cannot be queried for this mailbox).
   */
  laterCount: number | null;
  /** Required ISO-8601 wake time. Later is never indefinite (D245). */
  snoozedUntil: string;
  /** ISO-8601 — when the timer was last set; null when no timer. */
  snoozedAt: string | null;
  /** Optional user note (D79/D80); null when unset. */
  reason: string | null;
  /** Truthful state of this timer's scheduled return. */
  returnStatus: LaterReturnStatus;
  /** Last attempt to restore this sender, or null before the first attempt. */
  lastReturnAttemptAt: string | null;
  /** Safe recovery category; never a raw Gmail/provider error. */
  returnFailureKind: LaterReturnFailureKind;
}

export type LaterReturnStatus = 'scheduled' | 'returning' | 'retrying' | 'missed';
export type LaterReturnFailureKind = 'temporary' | 'reauthorize' | 'needs_attention' | null;

/** Two missed 15-minute sweeps before an unattempted return is called missed. */
export const LATER_RETURN_MISSED_AFTER_MS = 30 * 60 * 1_000;

/**
 * Small all-tier safety surface used by the app chrome. Full Later
 * management remains tiered; recovery from a failed product action does not.
 */
export interface LaterReturnRecoverySummary {
  affectedCount: number;
  firstIssue: {
    senderId: string;
    displayName: string;
    email: string;
    snoozedUntil: string;
    returnStatus: 'retrying' | 'missed';
    lastReturnAttemptAt: string | null;
    returnFailureKind: LaterReturnFailureKind;
  } | null;
}

/** Snooze reason length cap — one short note, not a journal (D79). */
export const SNOOZE_REASON_MAX_LENGTH = 200;

/**
 * PATCH /api/snoozed/:senderId body.
 *
 * `until: <ISO datetime>` sets or extends the wake timer and must be in
 * the future at request time. A Later item cannot be made indefinite;
 * Wake now is the explicit way to return it immediately.
 *
 * `reason` is optional; it is stored verbatim (trimmed) and shown on
 * the row.
 */
export const SnoozeUpdateRequestSchema = z
  .object({
    until: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(1).max(SNOOZE_REASON_MAX_LENGTH).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (Date.parse(body.until) <= Date.now()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['until'],
        message: 'Wake time must be in the future.',
      });
    }
  });

export type SnoozeUpdateRequest = z.infer<typeof SnoozeUpdateRequestSchema>;

/** PATCH result — the row's post-write snooze state. */
export interface SnoozeUpdateResult {
  senderId: string;
  snoozedUntil: string;
  /** ISO-8601 time when the timer was last set. */
  snoozedAt: string | null;
  reason: string | null;
  /** False when the write was an idempotent no-op (already at target). */
  changed: boolean;
}

/**
 * POST /api/snoozed/:senderId/wake result. The wake itself executes in
 * the snooze-wake worker (Gmail label restore + mirror + timer clear) —
 * the endpoint enqueues and returns `queued`. Re-posting within the
 * same minute dedups onto the same job.
 */
export interface WakeNowResult {
  senderId: string;
  status: 'queued';
}
