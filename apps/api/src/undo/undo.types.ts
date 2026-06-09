/**
 * Undo journal action-kind types (D35, D58, D232).
 *
 * Re-exported from `@declutrmail/db` — the `undo_action_kind` pg_enum
 * is the source of truth (`packages/db/src/schema/undo-journal.ts`).
 * Adding a verb requires touching the migration + the enum; this
 * re-export keeps the API contract aligned at compile time.
 */
import type { UndoActionKind } from '@declutrmail/db';

export type { UndoActionKind };

/**
 * Per-action payload shape (D232).
 *
 * Each verb persists the minimum state needed to reverse the mutation.
 * Privacy posture (D7, D228): payloads only carry Gmail identifiers
 * (message ids, label ids) — NEVER body content, snippets, or subject
 * text. The architecture-guardian's "no body in payload" rule is the
 * column-level enforcer; this discriminated union is the
 * compile-time guardrail that types correctly route to it.
 */
export type UndoPayload =
  | {
      kind: 'archive';
      /** Gmail message ids that were archived (removed from INBOX). */
      messageIds: string[];
      /** Labels present before the action — restored on revert. */
      priorLabels: string[];
    }
  | {
      kind: 'unsubscribe';
      /**
       * The sender identity touched. The unsubscribe network call is
       * NOT reversible (D58: "Unsub: not reversible · Auto-archive:
       * Undo →"); only the future-archive policy reverts. We persist
       * the sender_key so the revert can wipe the auto-archive policy.
       */
      senderKey: string;
      /** Optional message ids if the unsub also archived a batch. */
      messageIds?: string[];
      priorLabels?: string[];
    }
  | {
      kind: 'later';
      /** Messages moved to the "Later" snooze bucket. */
      messageIds: string[];
      priorLabels: string[];
    }
  | {
      kind: 'apply-rule';
      /** The Autopilot rule whose application is being reverted (D99). */
      ruleId: string;
      /** Messages the rule touched. */
      messageIds: string[];
      priorLabels: string[];
    };

/**
 * Outcome reported back to the client.
 *
 * `reverted` is true on a successful (first or replayed-idempotent)
 * revert. `expired` is true when the token's window has already closed
 * — the handler returns HTTP 410 in that case (D58 "Undo expired"
 * tooltip).
 */
export interface UndoResult {
  token: string;
  actionKind: UndoActionKind;
  reverted: boolean;
  expired: boolean;
  /** ISO timestamp of the revert (first-success time when idempotent). */
  revertedAt: string | null;
  /**
   * The reverse action job enqueued for this revert (D226 — undo runs
   * async in the worker). Poll `GET /api/actions/:actionId` for `done`.
   * Null when the token was already reverted (no new job) — `reverted`
   * is then already true.
   */
  actionId: string | null;
}
