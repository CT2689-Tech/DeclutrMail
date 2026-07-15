/**
 * Autopilot approve + preview contracts (U14 — D99, D101, D104).
 *
 * Zod schemas for the three Autopilot mutation/preview endpoints added
 * with the action-consumer worker:
 *
 *   - `POST /api/autopilot/matches/approve`     — approve selected
 *     pending Observe-mode suggestions (body =
 *     `AutopilotApproveMatchesRequest`).
 *   - `POST /api/autopilot/rules/:id/approve-all` — approve every
 *     pending suggestion for one rule (no body).
 *   - `POST /api/autopilot/rules/:id/preview`     — dry-run: what WOULD
 *     this rule match right now (no body; no mutation).
 *
 * Privacy (D7, D228): the preview sample carries the sender's display
 * name + email (both on the D7 storage allowlist — sender identity is
 * the FIRST item on the list) plus the matcher's reason string built
 * from engine signals. No subject, no snippet, no body, no headers.
 */

import { z } from 'zod';

/** UUID v4 — match / rule ids. */
const UuidSchema = z.string().uuid();

/**
 * Page cap on GET /api/autopilot/pending-suggestions. ONE constant
 * shared by the BE read-service (LIMIT) and the FE screen (the
 * "N pending in the latest 50" honesty copy) — the truncation signal
 * is only honest while both sides agree on the cap, so a bump here
 * moves both at once instead of silently re-introducing dishonest
 * counts.
 */
export const AUTOPILOT_PENDING_PAGE_SIZE = 50;

/**
 * Approve-selected request body. Bounded at 2× the pending page size
 * per call — covers a "select all on both mailbox tabs" worst case
 * without letting a client batch unbounded work into one request.
 */
export const AutopilotApproveMatchesRequestSchema = z
  .object({
    matchIds: z
      .array(UuidSchema)
      .min(1)
      .max(AUTOPILOT_PENDING_PAGE_SIZE * 2),
  })
  .strict();
export type AutopilotApproveMatchesRequest = z.infer<typeof AutopilotApproveMatchesRequestSchema>;

/**
 * Result of either approve endpoint. Idempotency contract mirrors the
 * dismiss endpoint's (D202/D207 Phase 1): a replayed approve returns
 * 200 with `approvedCount=0` + `alreadyResolvedCount` covering the
 * rows that were approved/dismissed before this call.
 */
export const AutopilotApproveResultSchema = z
  .object({
    /** Rows this call flipped `pending → approved`. */
    approvedCount: z.number().int().nonnegative(),
    /**
     * Rows that were already terminal (approved or dismissed) for THIS
     * mailbox — benign replays. Ids not found in the mailbox at all are
     * NOT counted here (cross-tenant probes collapse to absence).
     */
    alreadyResolvedCount: z.number().int().nonnegative(),
    /**
     * True when an `autopilot-action` sweep job was enqueued for the
     * mailbox (i.e. ≥1 row flipped and the queue is up).
     */
    executionEnqueued: z.boolean(),
  })
  .strict();
export type AutopilotApproveResult = z.infer<typeof AutopilotApproveResultSchema>;

/** One preview sample row — metadata only (D7 allowlist). */
export const AutopilotPreviewSampleSchema = z
  .object({
    /** sha256("v1|" + normalized_email), hex — never the raw address alone. */
    senderKey: z.string().regex(/^[0-9a-f]{64}$/),
    /** Display name from the senders index; null in the materialisation race window. */
    senderName: z.string().nullable(),
    /** Sender email (D7 allowlist item #1); null in the same race window. */
    senderEmail: z.string().nullable(),
    /** Matcher's human-readable branch label ("Read rate 2%, last seen 120d ago"). */
    reason: z.string(),
  })
  .strict();
export type AutopilotPreviewSample = z.infer<typeof AutopilotPreviewSampleSchema>;

/** Evidence behind the pre-activation weekly-volume estimate. */
export const AutopilotWeeklyVolumeSchema = z
  .object({
    /** Observe-mode matches actually recorded inside the measurement window. */
    observedMatches: z.number().int().nonnegative(),
    /** Calendar days represented by the window (1–7). */
    observedDays: z.number().int().min(1).max(7),
    /** Seven-day match volume: observed directly or extrapolated from an early window. */
    estimatedMatches: z.number().int().nonnegative(),
    /** Makes an early extrapolation impossible to mistake for seven days of evidence. */
    basis: z.enum(['observed_7d', 'early_estimate']),
  })
  .strict();
export type AutopilotWeeklyVolume = z.infer<typeof AutopilotWeeklyVolumeSchema>;

/**
 * Dry-run preview result (D103's "If active now, this rule would have
 * affected: X senders" — scoped to the preset surface at V2 per D192).
 */
export const AutopilotRulePreviewResultSchema = z
  .object({
    ruleId: UuidSchema,
    /** Unprotected senders the rule's matcher matches against CURRENT signals. */
    wouldMatchCount: z.number().int().nonnegative(),
    /** Matching, unprotected senders whose configured action would do work now. */
    actionableSenderCount: z.number().int().nonnegative(),
    /** Current INBOX messages belonging to those actionable senders. */
    actionableMessageCount: z.number().int().nonnegative(),
    /** Matching senders excluded because they are Protected. */
    protectedWouldMatchCount: z.number().int().nonnegative(),
    /** Senders evaluated (post protect-filter). */
    evaluatedSenders: z.number().int().nonnegative(),
    /** Per-rule rolling 24-hour execution guard enforced by the action worker. */
    dailyActionCap: z.number().int().positive(),
    /** Match volume learned during Observe, with an explicit evidence basis. */
    weeklyVolume: AutopilotWeeklyVolumeSchema,
    /** Up to 10 sample matches, metadata only. */
    sample: z.array(AutopilotPreviewSampleSchema).max(10),
  })
  .strict();
export type AutopilotRulePreviewResult = z.infer<typeof AutopilotRulePreviewResultSchema>;
