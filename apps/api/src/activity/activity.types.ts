// apps/api/src/activity/activity.types.ts — wire types for the Activity
// feed surface (D55-D60, tracer-bullet scope).
//
// Mirrors `activity_log` rows in their external-facing form: ISO strings
// instead of Date, sender identity joined in, and the undo state
// resolved to a single discriminated `undoState` field (in-window /
// expired / unavailable) so the FE doesn't need to compute "is the
// undo button live?" from raw timestamps.
//
// Privacy (D7, D228): metadata only. The schema does not declare body,
// snippet, or non-allowlisted headers; the read service constructs
// these rows from `activity_log` + `senders` + `undo_journal` only.

import type { ActivityLogEntry } from '@declutrmail/db';

/**
 * D55 time-window enum. `'all'` is Pro/Power only per D55 — the read
 * service enforces this on caller's behalf once tier wiring lands; for
 * the tracer-bullet release every window is allowed (founder
 * follow-up tracks the tier gate).
 */
export type ActivityWindow = '7d' | '30d' | '90d' | 'all';

/**
 * D56 source filter. Mirrors the `activity_source` enum
 * (`triage|manual|autopilot|screener`) — the tracer-bullet does not
 * expose D56's "Senders" or "Brief" chips because neither maps to a
 * source value in the current schema (both would need writer changes
 * + an enum extension; see FOUNDER-FOLLOWUPS).
 */
export type ActivitySourceFilter = 'all' | ActivityLogEntry['source'];

/**
 * One row on `GET /api/activity`. Sender identity is null-safe — the
 * schema permits account-scoped rows (`sender_key IS NULL`); those
 * render as "Account-scoped action" client-side.
 */
export interface ActivityRow {
  id: string;
  /** ISO-8601 — when the user took the action (or it was applied). */
  occurredAt: string;
  source: ActivityLogEntry['source'];
  /** Canonical verb (D227) or `followup-dismiss` (D88). */
  action: ActivityLogEntry['action'];
  /**
   * Number of messages the action moved — D57 "Count" column. Zero
   * for Keep entries (no messages moved; the verdict was recorded).
   */
  affectedCount: number;
  /** Sender identity joined from `senders`; null for account-scoped rows. */
  sender: ActivitySender | null;
  /** D58 undo affordance state — see {@link UndoState}. */
  undoState: UndoState;
}

export interface ActivitySender {
  /** sha256(...) of the normalized email; matches `senders.sender_key`. */
  senderKey: string;
  displayName: string;
  email: string;
  /** Domain extracted from email — convenience for the row meta line. */
  domain: string;
}

/**
 * D58 undo affordance state — pre-resolved by the read service so the
 * FE branches on a closed enum, not raw timestamps.
 *
 * Variants:
 *   - `available`       — undo button live; carries the token + expiry.
 *   - `expired`         — window passed; render "Undo expired · expired on …".
 *   - `executed`        — undo already taken; render "Undone" pill.
 *   - `unavailable`     — no undo token issued (Keep entries, pre-journal
 *                         historical rows, or actions that don't issue tokens).
 */
export type UndoState =
  | { kind: 'available'; token: string; expiresAt: string }
  | { kind: 'expired'; expiredAt: string }
  | { kind: 'executed'; executedAt: string }
  | { kind: 'unavailable' };

/**
 * D59 stats header — verb-aggregated counts within the selected window.
 * Computed by the same read call so the FE doesn't run a second
 * round-trip + so the counts always reflect the same filter the rows
 * list does.
 */
export interface ActivityStats {
  archived: number;
  unsubscribed: number;
  kept: number;
  later: number;
  followupsDismissed: number;
  /**
   * D59 "needing attention" — reserved for the failed-action surface
   * that lands with the action_jobs join (deferred). Zero for now.
   */
  needsAttention: number;
}

/** Pagination `meta` carries `total` so D59 stats can show the window total. */
export interface ActivityListMeta {
  /** Next-page cursor; omitted on the last page. */
  nextCursor?: string;
  stats: ActivityStats;
  /** Echo back the resolved window + source so the FE renders chips correctly. */
  window: ActivityWindow;
  source: ActivitySourceFilter;
}
