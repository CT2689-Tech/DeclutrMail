/**
 * Branded identifier types (FOUNDER-FOLLOWUPS 2026-06-05).
 *
 * The bulk-undo loop reads `row.undoState.token` AND `row.id` from the
 * same object; a typo at the call site is a runtime 404, not a compile
 * error. Branded types fix that — a `SenderId` cannot be passed where
 * `MailboxId` is expected, even though both are `string` at runtime.
 *
 * Style: zero-cost branding via `& { readonly __brand: ... }`. No
 * runtime construction wrapper unless a caller needs a parse step (we
 * trust internal callers; the parse helpers are reserved for surfaces
 * crossing the wire — controllers, query keys).
 *
 * Conventions:
 *   - Brand suffix is the type name (e.g. `__brand: 'SenderId'`).
 *   - `as` casts at trust boundaries are explicit and centralised in
 *     the controller / API adapter layer.
 *   - DO NOT use these for Gmail-side IDs (messageId, threadId,
 *     historyId) — those are intentionally raw `string` because they
 *     come from Gmail and we don't own their format guarantees.
 */

/** Internal DB UUID for a sender row (`senders.sender_id`). */
export type SenderId = string & { readonly __brand: 'SenderId' };

/** Internal DB UUID for a mailbox account (`mailbox_accounts.mailbox_account_id`). */
export type MailboxId = string & { readonly __brand: 'MailboxId' };

/** Internal DB UUID for a user row (`users.user_id`). */
export type UserId = string & { readonly __brand: 'UserId' };

/** Per-action UUID issued by ActionsService. */
export type ActionId = string & { readonly __brand: 'ActionId' };

/**
 * Undo token issued by `UndoService.issueToken`.
 *
 * Distinct from `ActionId` because the same action can have multiple
 * undo tokens emitted by the journal (one per reverse-job batch in
 * composite verbs).
 */
export type UndoToken = string & { readonly __brand: 'UndoToken' };

/**
 * `sha256("v1|" + normalized_email)` per D12.
 *
 * Distinct from `SenderId` because the same `sha256` can map to several
 * `sender_id`s across mailboxes — `senders` is per-mailbox.
 */
export type SenderKey = string & { readonly __brand: 'SenderKey' };

/**
 * Action_jobs idempotency-key string (the value the FE sends in the
 * `Idempotency-Key` header). Brand-distinct from `ActionId` so the two
 * can't be swapped at the storage boundary.
 */
export type IdempotencyKey = string & { readonly __brand: 'IdempotencyKey' };

/* ────────────────────────────────────────────────────────────────────
 * Boundary parsers — used at wire entry points (controllers / DTO
 * adapters) so the rest of the FE/BE code can treat ids as branded
 * without `as` casts spreading.
 *
 * Each parser:
 *   - Validates shape (`isUuid` / `isHex64`).
 *   - Throws on mismatch with a single error string the controller
 *     turns into a 400. Throwing > silently returning null because the
 *     caller forgot to check, and a bad id should be a hard 400.
 * ──────────────────────────────────────────────────────────────────── */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64_REGEX = /^[0-9a-f]{64}$/i;

function assertUuid(value: string, brand: string): void {
  if (!UUID_REGEX.test(value)) {
    throw new Error(`${brand}: invalid UUID format`);
  }
}

export function asSenderId(v: string): SenderId {
  assertUuid(v, 'SenderId');
  return v as SenderId;
}
export function asMailboxId(v: string): MailboxId {
  assertUuid(v, 'MailboxId');
  return v as MailboxId;
}
export function asUserId(v: string): UserId {
  assertUuid(v, 'UserId');
  return v as UserId;
}
export function asActionId(v: string): ActionId {
  assertUuid(v, 'ActionId');
  return v as ActionId;
}
export function asUndoToken(v: string): UndoToken {
  assertUuid(v, 'UndoToken');
  return v as UndoToken;
}
export function asSenderKey(v: string): SenderKey {
  if (!HEX64_REGEX.test(v)) {
    throw new Error('SenderKey: invalid sha256 hex format');
  }
  return v as SenderKey;
}
export function asIdempotencyKey(v: string): IdempotencyKey {
  if (v.length < 8 || v.length > 256) {
    throw new Error('IdempotencyKey: must be 8..256 chars');
  }
  return v as IdempotencyKey;
}
