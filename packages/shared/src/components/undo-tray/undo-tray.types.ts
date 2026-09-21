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

/** One sender's share of a decision — undoable on its own. */
export interface UndoTrayMember {
  token: string;
  actionKind: UndoActionKind;
  senderName: string | null;
  affectedCount: number;
}

/**
 * One row in the tray — one DECISION the user made. A bulk action over N
 * senders is one decision; `token` reverses all of it.
 *
 * Everything past `expiresAt` is optional on purpose: an API predating
 * the decision-grouped list omits it, and the row then renders exactly
 * as it always did (verb + deadline + Undo).
 */
export interface UndoTrayEntry {
  token: string;
  actionKind: UndoActionKind;
  /** ISO-8601 string from the API; rendered via `formatTimeLeft`. */
  createdAt: string;
  expiresAt: string;
  /** Stable identity — `token` can move when one member is undone. */
  groupId?: string;
  /** Distinct senders still undoable in this decision. */
  senderCount?: number;
  /** Total active members — what `members` was capped against. */
  memberCount?: number;
  /** Emails changed; `null` = unknown, never rendered as a number. */
  affectedCount?: number | null;
  /** True when members carry different verbs — one total would mislabel them. */
  mixedKinds?: boolean;
  /** Largest first; may be shorter than `senderCount` (capped server-side). */
  members?: UndoTrayMember[];
}

/**
 * Injection contract — the tray reads tokens, knows how to revert one.
 * Built by the host app on its own API client (CSRF, base URL,
 * 401-refresh); see `apps/web/src/features/triage/triage-undo-tray.tsx`.
 *
 * `isError` + `error` are optional for static sources (tests,
 * Storybook) that don't simulate failure. Live sources should supply
 * both so the tray can render a distinct error state — network failure
 * must NOT silently collapse the tray into the empty state (D211).
 */
/**
 * A line about an action that is NOT (yet) an undoable decision: still
 * running, or ended with nothing to undo (failed, partly failed, nothing
 * matched). The host composes the words; the tray owns the look.
 */
export interface UndoTrayNotice {
  id: string;
  /** `working` still running · `attention` ended badly · `info` ended, nothing changed. */
  tone: 'working' | 'attention' | 'info';
  /** "Archiving…" · "Archive failed" · "Nothing to archive". */
  label: string;
  /** "Yankee Candle + 2 others". */
  who?: string | null;
  /** Second line: "1 of 3 senders done". */
  detail?: string | null;
  /** Ended notices only — a line for a running job cannot be dismissed. */
  onDismiss?: () => void;
}

export interface UndoTrayDataSource {
  /** Running / ended-without-undo lines, shown above the decisions. */
  notices?: UndoTrayNotice[];
  /** Active tokens for the current mailbox, newest first (D35). */
  entries: UndoTrayEntry[];
  /** True while the initial / refresh fetch is in flight. */
  isLoading: boolean;
  /** Stable callback for one-row Undo (D58) — reverses the WHOLE decision. */
  revert: (token: string) => Promise<void>;
  /**
   * Reverse ONE member of a decision by its own token. Optional: without
   * it the disclosure still lists the senders, with no per-sender Undo.
   */
  revertMember?: (token: string) => Promise<void>;
  /** True when the most recent fetch failed (network/5xx). */
  isError?: boolean;
  /** The error from the failed fetch, if any. */
  error?: Error | null;
}
