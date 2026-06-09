/**
 * Public types for the persistent undo tray (D35).
 *
 * `UndoActionKind` is re-exported from `@declutrmail/shared/contracts`
 * (the FE-facing mirror of the `undo_action_kind` pg_enum). The
 * design-system package keeps its zero-server-dependency posture —
 * the cross-package contract test in `apps/api` asserts the mirror
 * stays aligned with the DB source of truth.
 */
import type { UndoActionKind } from '../../contracts/enum-mirrors';

export type { UndoActionKind };

/** One row in the tray — what the API returns per active token. */
export interface UndoTrayEntry {
  token: string;
  actionKind: UndoActionKind;
  /** ISO-8601 string from the API; rendered via `formatTimeLeft`. */
  createdAt: string;
  expiresAt: string;
}

/**
 * Hook contract — the tray reads tokens, knows how to revert one.
 *
 * `isError` + `error` are optional for backwards-compatibility with
 * static dataSource overrides (tests, Storybook) that don't simulate
 * failure. The TanStack-backed `useUndoTray` (D200) supplies both so
 * the tray can render a distinct error state — network failure must
 * NOT silently collapse the tray into the empty state (D211).
 */
export interface UndoTrayDataSource {
  /** Active tokens for the current mailbox, newest first (D35). */
  entries: UndoTrayEntry[];
  /** True while the initial / refresh fetch is in flight. */
  isLoading: boolean;
  /** Stable callback for one-row Undo (D58). */
  revert: (token: string) => Promise<void>;
  /** True when the most recent fetch failed (network/5xx). */
  isError?: boolean;
  /** The error from the failed fetch, if any. */
  error?: Error | null;
}
