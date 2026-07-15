/**
 * Activity API — typed fetcher for the Activity feed (D55-D60,
 * tracer-bullet).
 *
 * Wire shape mirrors the BE contract frozen in
 * `apps/api/src/activity/activity.types.ts` and the controller at
 * `apps/api/src/activity/activity.controller.ts`. Drift between BE
 * return types and these declarations is a contract violation the
 * D202 envelope was designed to surface at compile time — same
 * wire-mirror convention as the Followups / Brief feature surfaces.
 *
 * Privacy (D7, D228). The BE explicitly never returns body, snippet,
 * or non-allowlisted headers. Activity rows carry sender identity,
 * occurredAt, source, action verb, affectedCount, and the resolved
 * undo state — all metadata.
 *
 * No client-side state lives here — the fetcher is a pure function
 * the TanStack Query hook in `features/activity/api/` calls from
 * `queryFn`.
 */

import type { ActivityRuleRef, Envelope, PaginationMeta } from '@declutrmail/shared/contracts';

import { apiGet, apiPost } from './client';

export type ActivityWindowWire = '7d' | '30d' | '90d' | 'all';

export type ActivitySourceWire = 'triage' | 'manual' | 'autopilot' | 'screener';

export type ActivitySourceFilterWire = 'all' | ActivitySourceWire;

/** Canonical verbs (D227 → K/A/U/L/D after ADR-0019) plus the D88
 *  followup-dismiss row variant and the Protect toggle audit
 *  entries (written by the senders policy write path; snake_case
 *  spelling follows D43's literal enum strings). */
export type ActivityActionWire =
  | 'keep'
  | 'archive'
  | 'unsubscribe'
  // D56 — the unsubscribe OUTCOME row, written by UnsubExecutionWorker on
  // a 2xx RFC 8058 accept. Distinct from the intent 'unsubscribe' (the
  // click) so the timeline shows the confirmation separately. Not a
  // K/A/U/L/D canonical verb (D227) and not offered as a filter chip —
  // it renders as a feed row only.
  | 'unsubscribe_confirmed'
  | 'unsubscribe_endpoint_accepted'
  | 'unsubscribe_failed'
  | 'unsubscribe_unconfirmed'
  | 'unsubscribe_action_required'
  | 'unsubscribe_draft_opened'
  | 'unsubscribe_user_marked_sent'
  | 'unsubscribe_unavailable'
  | 'later'
  | 'delete'
  | 'followup-dismiss'
  | 'marked_protected'
  | 'unmarked_protected';

/** Verb filter (B-track power-options) — multi-select on the wire. */
export type ActivityVerbFilterWire = ActivityActionWire;

export interface ActivitySenderWire {
  senderKey: string;
  displayName: string;
  email: string;
  domain: string;
}

/**
 * D58 undo affordance state — closed discriminated union resolved
 * server-side from the `undo_journal` join.
 */
export type ActivityUndoStateWire =
  | { kind: 'available'; token: string; expiresAt: string }
  | { kind: 'expired'; expiredAt: string }
  | { kind: 'executed'; executedAt: string }
  | { kind: 'unavailable' };

/**
 * Durable state for an action lineage that has not produced a confirmed
 * Activity outcome. Failed label actions can be reviewed safely; an
 * unsubscribe failure never exposes a blind retry.
 */
export type ActivityExecutionStateWire =
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
      resolution: 'review' | 'reconnect' | 'support';
    };

export interface ActivityRowWire {
  id: string;
  occurredAt: string;
  source: ActivitySourceWire;
  action: ActivityActionWire;
  affectedCount: number;
  sender: ActivitySenderWire | null;
  /**
   * D57 rule attribution (shared contract `ActivityRuleRefSchema`) —
   * non-null only for `source='autopilot'` rows whose originating rule
   * still exists; renders as "by Autopilot · <rule name>".
   */
  rule: ActivityRuleRef | null;
  undoState: ActivityUndoStateWire;
  /** Null for confirmed append-only Activity rows. */
  executionState: ActivityExecutionStateWire | null;
}

export interface ActivityStatsWire {
  archived: number;
  unsubscribed: number;
  kept: number;
  later: number;
  /** D227 K/A/U/L/D — Delete verb count (ADR-0019). Always present on
   *  the wire; `0` when no delete activity in the window. */
  deleted: number;
  followupsDismissed: number;
  /** D59 — failed-action surface; 0 until the action_jobs join lands. */
  needsAttention: number;
  /**
   * Historic monthly volume for senders represented by actions in the
   * selected window. This is not proof that future mail was prevented.
   */
  noisePreventedPerMonth: number | null;
}

export interface ActivityListMetaWire {
  pagination: PaginationMeta;
  // Pagination cursor lives on `pagination.nextCursor` (D202). Removed
  // the duplicate top-level `nextCursor?` per architecture-guardian.
  stats: ActivityStatsWire;
  /** All-time stats across the entire mailbox history (ignores filters). */
  allTimeStats: ActivityStatsWire;
  window: ActivityWindowWire;
  source: ActivitySourceFilterWire;
  /** Echo of the resolved verb filter (empty = no filter). */
  verbs: ActivityVerbFilterWire[];
  /** Echo of the resolved sender search term ('' = no filter). */
  senderQuery: string;
  /** Echo of the resolved custom date range (ISO); null when unset. */
  dateFrom: string | null;
  dateTo: string | null;
}

/**
 * Combined filter state for `GET /api/activity`.
 *
 * Every field is optional — the BE applies its own defaults (window=30d,
 * source=all, verbs=[], senderQuery=''). The FE always passes the
 * full set so query keys / URL state stay in lockstep across renders.
 */
export interface ActivityFilters {
  window?: ActivityWindowWire;
  source?: ActivitySourceFilterWire;
  /** Multi-select verb filter; empty / undefined means "no verb filter". */
  verbs?: readonly ActivityVerbFilterWire[];
  /** Sender substring search term; trimmed by the BE. */
  senderQuery?: string;
  /** Custom date range — overrides the window-derived lower bound. */
  dateFrom?: string | null;
  dateTo?: string | null;
}

/**
 * GET /api/activity — paginated feed for the current mailbox.
 * Defaults: window=30d, source=all, limit=25.
 */
export function fetchActivity(
  args: ActivityFilters & {
    cursor?: string | undefined;
    signal?: AbortSignal;
  },
): Promise<Envelope<ActivityRowWire[], ActivityListMetaWire>> {
  return apiGet<ActivityRowWire[]>('/api/activity', {
    ...(args.signal ? { signal: args.signal } : {}),
    query: {
      ...(args.window ? { window: args.window } : {}),
      ...(args.source ? { source: args.source } : {}),
      // CSV-joined repeat-safe — BE accepts both shapes; CSV keeps the
      // URL short when several verbs are selected.
      ...(args.verbs && args.verbs.length > 0 ? { verb: args.verbs.join(',') } : {}),
      ...(args.senderQuery ? { sender_q: args.senderQuery } : {}),
      ...(args.dateFrom ? { date_from: args.dateFrom } : {}),
      ...(args.dateTo ? { date_to: args.dateTo } : {}),
      ...(args.cursor ? { cursor: args.cursor } : {}),
    },
  }) as Promise<Envelope<ActivityRowWire[], ActivityListMetaWire>>;
}

/**
 * POST /api/undo/:token — revert the action recorded for `token`.
 *
 * The Activity row's `undoState.token` is the input; the BE enqueues a
 * reverse `action_jobs` row asynchronously and the FE invalidates the
 * Activity list query on success so the row flips to `executed` on the
 * next refetch.
 *
 * The fetcher swallows the typed envelope and returns nothing — every
 * caller wants the side effect, not the payload.
 */
export async function revertActivityUndo(token: string): Promise<void> {
  await apiPost<unknown>(`/api/undo/${encodeURIComponent(token)}`);
}
