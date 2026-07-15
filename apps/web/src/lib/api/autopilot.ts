/**
 * Autopilot API — typed fetchers for the Autopilot endpoints
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

import type {
  AutopilotApproveMatchesRequest,
  AutopilotApproveResult,
  AutopilotPreviewSample,
  AutopilotRulePreviewResult,
  Envelope,
} from '@declutrmail/shared/contracts';
import { apiGet, apiPatch, apiPost } from './client';

/**
 * Approve + preview wire shapes come from the shared Zod contracts
 * (`packages/shared/src/contracts/autopilot.ts`) — the BE validates
 * against the same schemas. Re-exported under the FE's `*Dto` naming
 * so feature code imports every Autopilot wire type from one place.
 */
export type AutopilotApproveResultDto = AutopilotApproveResult;
export type AutopilotRulePreviewResultDto = AutopilotRulePreviewResult;
export type AutopilotPreviewSampleDto = AutopilotPreviewSample;

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

/**
 * D10/D101 — Observe-mode digest for one rule: what the rule WOULD have
 * done, computed server-side from the Observe-mode match history
 * joined to current INBOX message counts (the same resolution the
 * action sweep uses). Counts only — no content (D7).
 */
export interface AutopilotObserveDigestDto {
  /** Total pending Observe-mode matches (uncapped — not the 50-row page). */
  pendingTotal: number;
  /** Distinct senders matched in the last 7 days (all resolutions). */
  senders7d: number;
  /** INBOX messages from those senders — what a sweep right now would act on. */
  messages7d: number;
}

/** One Autopilot rule, as the read service returns it. */
export interface AutopilotRuleDto {
  id: string;
  presetKey: AutopilotPresetKey | null;
  isPreset: boolean;
  name: string;
  enabled: boolean;
  mode: AutopilotRuleMode;
  modeChangedAt: string;
  /**
   * D10/D104 Observe-window projection (`modeChangedAt` + 7d).
   * ISO-8601 while the rule is in Observe mode; null otherwise. The
   * FE renders "(N days left)" off this.
   */
  observeWindowEndsAt: string | null;
  /**
   * True when the rule is in Observe mode AND the 7-day window has
   * elapsed. Drives the day-7 prompt banner (U15) — there is NO
   * server-side auto-promotion; the user explicitly switches to Active.
   */
  observeWindowElapsed: boolean;
  /**
   * D10 — ISO-8601 when the user dismissed the day-7 activation
   * prompt; null when never dismissed. Cleared server-side on every
   * mode transition so a fresh Observe window re-arms the prompt.
   */
  observePromptDismissedAt: string | null;
  /**
   * D10/D101 — Observe-mode digest ("would have archived N emails from
   * M senders in the last 7 days"). Non-null only in Observe mode.
   */
  observeDigest: AutopilotObserveDigestDto | null;
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

/**
 * Allowed `PATCH /api/autopilot/rules/:id` body. All fields optional.
 * Mirrors `AutopilotRulePatch` in `autopilot.types.ts`.
 */
export interface AutopilotRulePatchDto {
  /** D101 — toggle the rule on / off. */
  enabled?: boolean;
  /** D10 / D105 — observe ↔ active ↔ paused. */
  mode?: AutopilotRuleMode;
  /**
   * D101 threshold slider. Range `[0, 1]`. Only meaningful for
   * threshold-bearing presets; `null` resets to the preset default.
   */
  confidenceThreshold?: number | null;
  /** D102 — per-inbox vs all-inboxes. */
  scope?: AutopilotRuleScope;
  /**
   * D10 — day-7 activation prompt dismissal. `true` stamps the
   * dismissal server-side; `false` clears it. Mode changes also clear
   * it (fresh Observe window re-arms the prompt).
   */
  observePromptDismissed?: boolean;
}

/** One privacy-bounded repeated-decision opportunity (D246). */
export interface AutopilotPatternSuggestionDto {
  ruleId: string;
  presetKey: 'auto_archive_low_engagement' | 'auto_unsubscribe_noisy';
  ruleName: string;
  actionKind: 'archive' | 'unsubscribe';
  scope: 'account';
  evidenceCount: number;
  evidenceWindowDays: 30;
  dailyActionCap: number;
}

export interface AutopilotPatternSuggestionDecisionDto {
  ruleId: string;
  presetKey: AutopilotPatternSuggestionDto['presetKey'];
  decision: 'observe' | 'dismissed';
  evidenceCount: number;
  decidedAt: string;
}

/** One match row, as the pending-suggestions endpoint returns it. */
export interface AutopilotMatchDto {
  id: string;
  ruleId: string;
  /** sha256 hex digest — never the raw email (D7). */
  senderKey: string;
  /**
   * Sender display name — joined from `senders.display_name`. `null`
   * during the brief race window before `building_sender_index`
   * materialises the row; the FE falls back to the senderKey hash so
   * the row never blanks. D7-compliant — sender identity is on the
   * storage allowlist (FIRST item).
   */
  senderName: string | null;
  /** Sender email — joined from `senders.email`. Same race-null contract. */
  senderEmail: string | null;
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

/** GET one aggregate repeated-decision opportunity, or null. */
export function fetchPatternSuggestion(
  signal?: AbortSignal,
): Promise<Envelope<AutopilotPatternSuggestionDto | null, unknown>> {
  return apiGet<AutopilotPatternSuggestionDto | null>('/api/autopilot/pattern-suggestion', {
    signal,
  });
}

/** Accept into Observe or dismiss the currently eligible suggestion. */
export function postPatternSuggestionDecision(
  ruleId: string,
  decision: 'observe' | 'dismissed',
): Promise<Envelope<AutopilotPatternSuggestionDecisionDto, unknown>> {
  const action = decision === 'observe' ? 'observe' : 'dismiss';
  return apiPost<AutopilotPatternSuggestionDecisionDto>(
    `/api/autopilot/pattern-suggestion/${encodeURIComponent(ruleId)}/${action}`,
  );
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

/**
 * PATCH /api/autopilot/rules/:id — toggle enabled, change mode, adjust
 * threshold (D101, D105). Custom rules 404 per D234.
 */
export function patchAutopilotRule(
  ruleId: string,
  patch: AutopilotRulePatchDto,
): Promise<Envelope<AutopilotRuleDto, unknown>> {
  return apiPatch<AutopilotRuleDto>(`/api/autopilot/rules/${encodeURIComponent(ruleId)}`, patch);
}

/**
 * POST /api/autopilot/matches/approve — D104 "Approve selected".
 * Flips pending Observe-mode suggestions to `approved` + enqueues the
 * action sweep. Idempotent (replays return `approvedCount=0`).
 */
export function postApproveMatches(
  body: AutopilotApproveMatchesRequest,
): Promise<Envelope<AutopilotApproveResult, unknown>> {
  return apiPost<AutopilotApproveResult>('/api/autopilot/matches/approve', body);
}

/**
 * POST /api/autopilot/rules/:id/approve-all — D104 "Approve all".
 * Approves every pending suggestion for the rule. Does NOT change the
 * rule's mode (the "and switch to Active" variant is this + a PATCH).
 */
export function postApproveAllForRule(
  ruleId: string,
): Promise<Envelope<AutopilotApproveResult, unknown>> {
  return apiPost<AutopilotApproveResult>(
    `/api/autopilot/rules/${encodeURIComponent(ruleId)}/approve-all`,
  );
}

/**
 * POST /api/autopilot/rules/:id/preview — D103/D192 dry-run preview.
 * Read-only: would-match count + a 10-row metadata-only sample.
 */
export function postRulePreview(
  ruleId: string,
): Promise<Envelope<AutopilotRulePreviewResult, unknown>> {
  return apiPost<AutopilotRulePreviewResult>(
    `/api/autopilot/rules/${encodeURIComponent(ruleId)}/preview`,
  );
}
