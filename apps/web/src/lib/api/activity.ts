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

import type { Envelope, PaginationMeta } from '@declutrmail/shared/contracts';

import { apiGet } from './client';

export type ActivityWindowWire = '7d' | '30d' | '90d' | 'all';

export type ActivitySourceWire = 'triage' | 'manual' | 'autopilot' | 'screener';

export type ActivitySourceFilterWire = 'all' | ActivitySourceWire;

/** Canonical verbs (D227 → K/A/U/L/D after ADR-0019) plus the D88
 *  followup-dismiss row variant. */
export type ActivityActionWire =
  | 'keep'
  | 'archive'
  | 'unsubscribe'
  | 'later'
  | 'delete'
  | 'followup-dismiss';

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

export interface ActivityRowWire {
  id: string;
  occurredAt: string;
  source: ActivitySourceWire;
  action: ActivityActionWire;
  affectedCount: number;
  sender: ActivitySenderWire | null;
  undoState: ActivityUndoStateWire;
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
}

export interface ActivityListMetaWire {
  pagination: PaginationMeta;
  nextCursor?: string;
  stats: ActivityStatsWire;
  window: ActivityWindowWire;
  source: ActivitySourceFilterWire;
}

/**
 * GET /api/activity — paginated feed for the current mailbox.
 * Defaults: window=30d, source=all, limit=25.
 */
export function fetchActivity(args: {
  window?: ActivityWindowWire;
  source?: ActivitySourceFilterWire;
  cursor?: string | undefined;
  signal?: AbortSignal;
}): Promise<Envelope<ActivityRowWire[], ActivityListMetaWire>> {
  return apiGet<ActivityRowWire[]>('/api/activity', {
    ...(args.signal ? { signal: args.signal } : {}),
    query: {
      ...(args.window ? { window: args.window } : {}),
      ...(args.source ? { source: args.source } : {}),
      ...(args.cursor ? { cursor: args.cursor } : {}),
    },
  }) as Promise<Envelope<ActivityRowWire[], ActivityListMetaWire>>;
}
