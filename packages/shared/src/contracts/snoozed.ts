// @declutrmail/shared/contracts — Snoozed/Later surface (D78–D80).
//
// Wire contract for the Snoozed review screen:
//
//   GET   /api/snoozed              → Envelope<SnoozedSenderRow[]>
//   PATCH /api/snoozed/:senderId    → Envelope<SnoozeUpdateResult>
//   POST  /api/snoozed/:senderId/wake → Envelope<WakeNowResult>
//
// Scope is SENDER-level only (D78) — there is no message-level snooze
// at launch. "Later" is the canonical user-facing verb (D227); the
// screen/feature name is "Snoozed" (the D78–D83 topic name, like
// "Screener" for the screen feature).
//
// PRIVACY (D7, D228): rows carry sender display metadata (name, email,
// domain — all from the `senders` projection), counts, and timestamps.
// No subjects, no snippets, no body-adjacent content.

import { z } from 'zod';

/**
 * One sender on the Snoozed screen. A sender is listed when EITHER:
 *
 *   - it currently has ≥1 message carrying the DeclutrMail/Later Gmail
 *     label (`laterCount > 0`) — the durable ground truth written by
 *     the Later verb's label-action pipeline and mirrored into
 *     `mail_messages.label_ids`; OR
 *   - it has an active snooze timer (`snoozedUntil` non-null) set via
 *     `PATCH /api/snoozed/:senderId` (D79 schema columns).
 *
 * Both can hold at once (the normal case: Later'd mail + a wake time).
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
  /** ISO-8601 wake time; null = no wake time set (stays until woken). */
  snoozedUntil: string | null;
  /** ISO-8601 — when the timer was last set; null when no timer. */
  snoozedAt: string | null;
  /** Optional user note (D79/D80); null when unset. */
  reason: string | null;
}

/** Snooze reason length cap — one short note, not a journal (D79). */
export const SNOOZE_REASON_MAX_LENGTH = 200;

/**
 * PATCH /api/snoozed/:senderId body.
 *
 * `until: <ISO datetime>` sets or extends the wake timer (must be in
 * the future at request time). `until: null` clears the timer AND the
 * reason ("Cancel snooze" per D80 — the Later'd mail stays where it is;
 * only the wake schedule is removed).
 *
 * `reason` is optional and only meaningful alongside a non-null
 * `until`; it is stored verbatim (trimmed) and shown on the row.
 */
export const SnoozeUpdateRequestSchema = z
  .object({
    until: z.string().datetime({ offset: true }).nullable(),
    reason: z.string().trim().min(1).max(SNOOZE_REASON_MAX_LENGTH).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.until !== null && Date.parse(body.until) <= Date.now()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['until'],
        message: 'Wake time must be in the future.',
      });
    }
    if (body.until === null && body.reason !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'reason cannot be set when clearing the timer.',
      });
    }
  });

export type SnoozeUpdateRequest = z.infer<typeof SnoozeUpdateRequestSchema>;

/** PATCH result — the row's post-write snooze state. */
export interface SnoozeUpdateResult {
  senderId: string;
  snoozedUntil: string | null;
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
