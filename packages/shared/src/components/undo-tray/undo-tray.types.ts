/**
 * Public types for the persistent undo tray (D35).
 *
 * `UndoActionKind` is re-exported from `@declutrmail/shared/contracts`
 * (server-safe; zero-server-dep posture preserved). The literal-union
 * mirror of the DB pg_enum is asserted equal to the API type in
 * `apps/api/src/undo/undo.types.ts`. Adding a verb without updating
 * that one mirror fails-compile.
 */
export type { UndoActionKind } from '../../contracts/undo-action-kind';
import type { UndoActionKind } from '../../contracts/undo-action-kind';

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
