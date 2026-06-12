// @declutrmail/shared/contracts/account-deletion — D205/D216/D232
// account-deletion wire contract, shared by the BE controller
// (apps/api/src/account/) and the FE hooks
// (apps/web/src/features/account-deletion/).
//
// D232 semantics encoded here:
//
//   effective_at = max(now + 7 days, latest_undo_expires_at)
//
// where `latest_undo_expires_at` aggregates across ALL the user's
// mailboxes (per-USER, not per-mailbox). Two typed confirmation
// phrases (D216 + D232 waiver path):
//
//   - `DELETE`                 → schedule at the max-of date.
//   - `DELETE AND WAIVE UNDO`  → waive open undo windows; deletion
//                                executes at the next purge sweep
//                                ("immediate" per the F5 ledger).
//
// Anything else is a 400 (`DELETION_CONFIRM_MISMATCH`) — the server
// re-validates; the FE typed-confirm input is UX, not the gate.

import { z } from 'zod';

/** D216 typed confirmation — schedules deletion per the D232 max-of. */
export const DELETION_CONFIRM_PHRASE = 'DELETE';

/**
 * D232 waiver phrase — LITERAL match required. Waives open undo
 * windows AND the 7-day grace floor (F5 ledger: waiver = purge ASAP).
 */
export const DELETION_WAIVER_PHRASE = 'DELETE AND WAIVE UNDO';

/** POST /api/account/deletion request body. */
export const AccountDeletionRequestSchema = z.object({
  /** The typed confirmation phrase, compared verbatim (case-sensitive). */
  confirmPhrase: z.string().min(1, 'Type the confirmation phrase to continue.'),
});
export type AccountDeletionRequest = z.infer<typeof AccountDeletionRequestSchema>;

/** Which branch of the D232 formula produced `effectiveAt`. */
export const AccountDeletionBasisSchema = z.enum(['flat-grace', 'undo-window', 'waived-immediate']);
export type AccountDeletionBasis = z.infer<typeof AccountDeletionBasisSchema>;

/**
 * The D232 schedule inputs, always computed fresh (per-USER undo
 * aggregate). Served on every status read so the Settings UI can show
 * the projected effective date BEFORE a request exists ("You have N
 * undoable actions, the latest expiring in M days") and the live date
 * while one is pending.
 */
export const AccountDeletionProjectionSchema = z.object({
  /** `now + 7d` at computation time (ISO-8601). */
  flatGraceAt: z.string(),
  /** Latest active undo expiry across ALL the user's mailboxes; null = none. */
  latestUndoExpiresAt: z.string().nullable(),
  /** Active (unexpired, unreverted) undo tokens across all mailboxes. */
  activeUndoCount: z.number().int().nonnegative(),
  /** `max(flatGraceAt, latestUndoExpiresAt)` — where DELETE would land. */
  projectedEffectiveAt: z.string(),
  /** Which input dominates the projection. */
  projectedBasis: z.enum(['flat-grace', 'undo-window']),
});
export type AccountDeletionProjection = z.infer<typeof AccountDeletionProjectionSchema>;

/** One pending (or executing) deletion request, as served to the FE. */
export const AccountDeletionPendingSchema = z.object({
  id: z.string(),
  requestedAt: z.string(),
  effectiveAt: z.string(),
  basis: AccountDeletionBasisSchema,
  waiverConfirmed: z.boolean(),
  status: z.enum(['pending', 'executing']),
});
export type AccountDeletionPending = z.infer<typeof AccountDeletionPendingSchema>;

/**
 * GET /api/account/deletion response. `request` is null when no
 * deletion is in flight; `projection` is always present so the
 * typed-confirm modal can render honest D232 copy up front.
 */
export const AccountDeletionStatusSchema = z.object({
  request: AccountDeletionPendingSchema.nullable(),
  projection: AccountDeletionProjectionSchema,
});
export type AccountDeletionStatus = z.infer<typeof AccountDeletionStatusSchema>;
