/**
 * Autopilot API — typed fetchers for the six Autopilot endpoints
 * (D99-D105, D234). Mirrors the BE wire contract in
 * `apps/api/src/autopilot/autopilot.types.ts`. The BE is the
 * source-of-truth; if these types drift, the TanStack hooks above will
 * type-error first.
 *
 * Privacy (D7, D228). The match payload returns `senderKey` as the
 * sha256 hex digest — never the raw email. No body content, no
 * attachments, no non-allowlisted headers.
 *
 * Custom rules (D196, D197, D234). The list endpoint only ever returns
 * preset rules at V2 because the API rejects `is_preset = false`. The
 * FE keeps `isPreset` on the wire type so the V2.1 unlock is a UI-only
 * change.
 */

import type { Envelope } from '@declutrmail/shared/contracts';
import { apiGet, apiPost } from './client';

/** Rule lifecycle (D10, D105). Mirrors `autopilot_rule_mode` pgEnum. */
export type AutopilotRuleMode = 'observe' | 'active' | 'paused';

/** Scope of a rule (D102). Mirrors `autopilot_rule_scope` pgEnum. */
export type AutopilotRuleScope = 'account' | 'all_accounts' | 'workspace';

/** Action a rule emits. Mirrors `autopilot_action_kind` pgEnum. */
export type AutopilotActionKind = 'archive' | 'unsubscribe' | 'later';

/** Preset library at launch (D101 + D124). Custom rules are NULL. */
export type AutopilotPresetKey =
  | 'auto_archive_low_engagement'
  | 'auto_unsubscribe_noisy'
  | 'auto_screen_new_senders'
  | 'newsletter_graveyard'
  | 'long_dormant_unsubscribe';

/** Mode the rule was in when this match was recorded. */
export type AutopilotMatchMode = 'observe' | 'active';

/** User decision on the buffered suggestion (D104). */
export type AutopilotMatchResolution = 'pending' | 'approved' | 'dismissed';

/** One Autopilot rule, as the read service returns it. */
export interface AutopilotRuleDto {
  id: string;
  presetKey: AutopilotPresetKey | null;
  isPreset: boolean;
  name: string;
  enabled: boolean;
  mode: AutopilotRuleMode;
  modeChangedAt: string;
  confidenceThreshold: number | null;
  scope: AutopilotRuleScope;
  actionKind: AutopilotActionKind;
  actionPayload: Record<string, unknown>;
  lastRunAt: string | null;
  lastRunActions: number;
  lastRunSenders: number;
  createdAt: string;
  updatedAt: string;
}

/** One match row, as the pending-suggestions endpoint returns it. */
export interface AutopilotMatchDto {
  id: string;
  ruleId: string;
  /** sha256 hex digest — never the raw email (D7). */
  senderKey: string;
  matchedAt: string;
  modeAtMatch: AutopilotMatchMode;
  confidence: number;
  reason: string;
  resolution: AutopilotMatchResolution;
  intentApplied: boolean;
  intentToken: string | null;
  resolvedAt: string | null;
}

/** Outcome of `POST /autopilot/pause-all` (D105). */
export interface AutopilotPauseAllResult {
  pausedCount: number;
}

/** Outcome of `POST /autopilot/matches/:id/dismiss` (D104). */
export interface AutopilotMatchDismissResult {
  resolution: AutopilotMatchResolution;
  resolvedAt: string;
}

// ── Fetchers ────────────────────────────────────────────────────────

/** GET /api/autopilot/rules — list rules for the caller's mailbox. */
export function fetchAutopilotRules(
  signal?: AbortSignal,
): Promise<Envelope<AutopilotRuleDto[], unknown>> {
  return apiGet<AutopilotRuleDto[]>('/api/autopilot/rules', { signal });
}

/** GET /api/autopilot/pending-suggestions — D104 Observe-mode buffer. */
export function fetchPendingSuggestions(
  signal?: AbortSignal,
): Promise<Envelope<AutopilotMatchDto[], unknown>> {
  return apiGet<AutopilotMatchDto[]>('/api/autopilot/pending-suggestions', { signal });
}

/** POST /api/autopilot/matches/:matchId/dismiss — D104 dismiss. */
export function postDismissMatch(
  matchId: string,
): Promise<Envelope<AutopilotMatchDismissResult, unknown>> {
  return apiPost<AutopilotMatchDismissResult>(
    `/api/autopilot/matches/${encodeURIComponent(matchId)}/dismiss`,
  );
}

/** POST /api/autopilot/pause-all — D105 master pause. */
export function postPauseAll(): Promise<Envelope<AutopilotPauseAllResult, unknown>> {
  return apiPost<AutopilotPauseAllResult>('/api/autopilot/pause-all');
}
