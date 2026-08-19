// Does a recorded protection reason still hold?
//
// One rule, two readers: the senders list/detail (`protectionFlags`) and
// the protection review (`readProtectionReview`). They previously would
// have owned a copy each, and a threshold that drifted between them would
// let the product explain a rule it does not apply — the exact class of
// defect D245 §"show the exact reason" exists to prevent.
//
// PRIVACY (D7 / D228): counts and an enum id. No sender identity, no
// message content. Safe in the client bundle.

/** Protection reasons, in the DB's spelling (`sender_policies.protection_reason`). */
export type ProtectionEvidenceReason = 'user_defined' | 'replied' | 'starred' | 'gmail_important';

/**
 * Automatic protection on two-way correspondence needs at least this many
 * outbound messages ADDRESSED to the sender (their address in To or Cc).
 *
 * Mirrors the SQL in `packages/workers/src/automatic-protection.ts`.
 */
export const PROTECTION_WROTE_TO_THRESHOLD = 3;

export interface ProtectionEvidenceInput {
  isProtected: boolean;
  reason: ProtectionEvidenceReason | null;
  /** `senders.wrote_to_count` — outbound messages addressed to them. */
  wroteToCount: number;
  /** `senders.total_received` — messages received FROM them. */
  receivedCount: number;
  /**
   * Does the mailbox have ANY outbound mail indexed? A mailbox whose Sent
   * mail was never indexed can produce no evidence for "you wrote to
   * them", which is not the same fact as the evidence being absent.
   */
  mailboxHasOutbound: boolean;
}

/**
 * `true` — holds, or there is nothing to check.
 * `false` — checked, and today's evidence does not support it.
 * `null` — NOT CHECKABLE (no outbound indexed).
 *
 * Consumers must render `null` exactly as `true`. Coercing unknown to
 * "unsupported" would indict every `replied` shield on such a mailbox in
 * one go — the null-becomes-zero mistake this codebase keeps paying for,
 * pointed at a safety state.
 *
 * NOTHING IS WITHDRAWN ON THIS VALUE. The auto-protect sweep never
 * unprotects a `replied` row; `false` means "surface it for the user to
 * decide", never "we already removed it".
 */
export function evaluateProtectionEvidence(input: ProtectionEvidenceInput): boolean | null {
  // An unprotected row makes no claim; the user's own Protect is not ours
  // to second-guess; `starred` / `gmail_important` are re-evaluated from
  // labels we still hold, by the sweep itself.
  if (!input.isProtected) return true;
  if (input.reason !== 'replied') return true;
  if (!input.mailboxHasOutbound) return null;
  return input.wroteToCount >= PROTECTION_WROTE_TO_THRESHOLD && input.receivedCount > 0;
}
