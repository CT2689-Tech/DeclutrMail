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

import type { ActivityRuleRef, CanonicalVerb } from '@declutrmail/shared/contracts';

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
  /**
   * D57 rule attribution — joined from `automation_rules` via
   * `activity_log.rule_id`. Non-null only for `source = 'autopilot'`
   * rows whose originating rule still exists (the FK is
   * `onDelete: 'set null'`, so a deleted rule degrades to null and the
   * FE falls back to plain "by Autopilot").
   */
  rule: ActivityRuleRef | null;
  /** D58 undo affordance state — see {@link UndoState}. */
  undoState: UndoState;
  /**
   * Durable execution truth for an action that has not produced an
   * `activity_log` completion row yet. Null for the append-only audit rows
   * that represent confirmed outcomes.
   */
  executionState: ActivityExecutionState | null;
}

/**
 * Current state of one root action lineage. Recovery attempts remain linked
 * to the original failed action, while `actionId` always names the attempt
 * whose state is currently rendered.
 */
export type ActivityExecutionState =
  | {
      kind: 'in_progress';
      actionId: string;
      requestedCount: number;
      isRecovery: boolean;
      status: 'queued' | 'executing';
    }
  | {
      kind: 'failed';
      actionId: string;
      rootActionId: string;
      requestedCount: number;
      errorCode: string | null;
      resolution: 'review' | 'support';
    };

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
  /** D227 K/A/U/L/D — Delete verb count (ADR-0019). Counts rows whose
   *  `activity_log.action = 'delete'`. Zero when no Delete activity in
   *  the window. */
  deleted: number;
  followupsDismissed: number;
  /**
   * D59 "needing attention" — truthful unsubscribe terminal outcomes
   * that failed or could not be confirmed in the selected window.
   */
  needsAttention: number;
  /**
   * Historic monthly volume for senders represented by actions in the
   * selected window. This is contextual sender history, not proof that
   * Archive, Later, or an unsubscribe request prevented future mail.
   */
  noisePreventedPerMonth: number | null;
}

/**
 * Set of action verbs the user can filter Activity by (B-track Activity
 * power-options). Identical to the `activity_log.action` enum.
 *
 * Multi-select on the wire — the FE chip group accepts any non-empty
 * subset; an empty/missing param means "no verb filter" (all verbs).
 */
export type ActivityVerbFilter = ActivityLogEntry['action'];

/**
 * Aggregate cleanup totals for one mailbox within a window — the
 * numbers a user would share / see at inbox-zero (DQ16 "cleanup
 * receipt" prerequisite; no D covers aggregate stats yet, D-number
 * pending founder ratification — see docs/execution/decision-queue.md).
 *
 * Counts only the five canonical verbs (K/A/U/L/D, D227 + ADR-0019);
 * feature-specific actions (`followup-dismiss`, Protect toggles)
 * are not cleanup decisions and are excluded from every field.
 *
 * Derived from existing tables only (`activity_log` + `undo_journal`);
 * read-only, no schema changes.
 */
export interface ActivitySummary {
  /** Echo of the resolved window param (D55 vocabulary). */
  window: ActivityWindow;
  /**
   * ISO-8601 `occurred_at` of the EARLIEST counted activity row — the
   * honest "counting since …" stamp for the receipt. Null when the
   * window contains no canonical-verb activity. For bounded windows
   * this is ≥ the window start; for `'all'` it is the first decision
   * ever recorded on the mailbox.
   */
  since: string | null;
  /**
   * Distinct senders the user decided on in the window —
   * `COUNT(DISTINCT sender_key)` over canonical-verb rows.
   * Account-scoped rows (`sender_key IS NULL`) do not count.
   */
  decidedSenders: number;
  /** Row counts per canonical verb (a decision each, D227 K/A/U/L/D). */
  byVerb: Record<CanonicalVerb, number>;
  /**
   * Total messages moved by canonical-verb decisions —
   * `SUM(affected_count)`. Keep rows contribute 0 by design (the
   * verdict is recorded; no messages move).
   */
  emailsHandled: number;
  /**
   * Undos the user performed (`undo_journal.reverted_at` within the
   * window). FLOOR, not an exact historical total: the undo-expiry
   * worker prunes journal rows ~1 day after `expires_at` (7d Free /
   * 30d Pro windows), so reverts older than the pruning horizon are
   * gone. Exact for recent windows; undercounts for `'all'`. An exact
   * lifetime count would need a schema change — out of scope here.
   */
  undoCount: number;
}

/** Pagination `meta` carries `total` so D59 stats can show the window total. */
export interface ActivityListMeta {
  // Pagination cursor lives on `meta.pagination.nextCursor` (D202).
  // The prior top-level `nextCursor?` was dropped — duplicate fields
  // are a contract drift surface (architecture-guardian 2026-06-05).
  stats: ActivityStats;
  /**
   * All-time stats — verb-aggregated counts across the user's ENTIRE
   * activity history (ignores window + verb + sender + date filters).
   * Powers the B-track "all-time totals" line so the user always sees
   * a stable running total of every action ever taken on the mailbox.
   *
   * Computed once per request (no extra hot-path round-trip).
   */
  allTimeStats: ActivityStats;
  /** Echo back the resolved window + source so the FE renders chips correctly. */
  window: ActivityWindow;
  source: ActivitySourceFilter;
  /** Echo back the resolved verb filter (empty = no filter). */
  verbs: ActivityVerbFilter[];
  /** Echo back the resolved sender search term (empty string = no filter). */
  senderQuery: string;
  /** Echo back the resolved custom date range (ISO strings); null if unset. */
  dateFrom: string | null;
  dateTo: string | null;
}
