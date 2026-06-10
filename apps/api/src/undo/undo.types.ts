import { undoActionKind } from '@declutrmail/db';

/**
 * Undo journal action-kind types (D35, D58, D232).
 *
 * Derived directly from the `undo_action_kind` Postgres enum
 * (see `packages/db/src/schema/undo-journal.ts`) — ONE source of truth.
 * Adding a verb is a single schema edit; the migration that lands the
 * pgEnum value automatically widens this type without a coordinated
 * literal-union edit here.
 *
 * Pattern reference: `VERDICT_RUNTIME_VALUES = triageVerdict.enumValues`
 * (`packages/workers/src/reasoning.ts`) + exhaustiveness test.
 */
export type UndoActionKind = (typeof undoActionKind.enumValues)[number];

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
      /**
       * Delete = Gmail TRASH label applied (spec v1.2 Decision 1). Revert
       * runs Gmail untrash via the worker's `change.reverse` — no
       * `priorLabels` needed because the reverse `LabelChange` is the
       * restoration step. Gmail's 30-day Trash recovery window is the
       * physical guarantee that the message is still present.
       */
      kind: 'delete';
      /** Gmail message ids moved to Trash. */
      messageIds: string[];
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

/**
 * Cross-package contract — apps/web + the shared design-system package
 * carry their own `UndoActionKind` mirror because shared is zero-server-
 * dep. These two compile-time assertions fail-compile if the API and
 * shared types ever drift: adding a verb to one without the other lights
 * up the build immediately rather than degrading silently to `string`.
 *
 * Pattern echoes the `as const satisfies Record<...>` shape in
 * `packages/events/src/events.ts:333`.
 */
import type { UndoActionKind as SharedUndoActionKind } from '@declutrmail/shared/contracts';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _UNDO_KIND_API_EXTENDS_SHARED: UndoActionKind extends SharedUndoActionKind ? true : false =
  true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _UNDO_KIND_SHARED_EXTENDS_API: SharedUndoActionKind extends UndoActionKind ? true : false =
  true;
