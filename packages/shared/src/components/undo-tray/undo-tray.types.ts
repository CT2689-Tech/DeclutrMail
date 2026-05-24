/**
 * Public types for the persistent undo tray (D35).
 *
 * Mirrored from the API's `UndoActionKind` enum (D227 destructive
 * verbs + Autopilot rule application). Replicated here instead of
 * imported from `@declutrmail/api` so the design-system package keeps
 * its zero-server-dependency posture — the apps/web layer will assert
 * the contracts match via a small contract test once both surfaces
 * land in the same PR slice.
 */
export type UndoActionKind = 'archive' | 'unsubscribe' | 'later' | 'apply-rule';

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
