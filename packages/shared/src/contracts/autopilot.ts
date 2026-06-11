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
 * Approve-selected request body. Bounded at 100 ids per call — the
 * pending-suggestions page is 50 rows, so 100 covers a "select all on
 * both mailbox tabs" worst case without letting a client batch
 * unbounded work into one request.
 */
export const AutopilotApproveMatchesRequestSchema = z
  .object({
    matchIds: z.array(UuidSchema).min(1).max(100),
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

/**
 * Dry-run preview result (D103's "If active now, this rule would have
 * affected: X senders" — scoped to the preset surface at V2 per D192).
 */
export const AutopilotRulePreviewResultSchema = z
  .object({
    ruleId: UuidSchema,
    /** Senders the rule's matcher matches against CURRENT signals. */
    wouldMatchCount: z.number().int().nonnegative(),
    /** Senders evaluated (post protect-filter). */
    evaluatedSenders: z.number().int().nonnegative(),
    /** Up to 10 sample matches, metadata only. */
    sample: z.array(AutopilotPreviewSampleSchema).max(10),
  })
  .strict();
export type AutopilotRulePreviewResult = z.infer<typeof AutopilotRulePreviewResultSchema>;
