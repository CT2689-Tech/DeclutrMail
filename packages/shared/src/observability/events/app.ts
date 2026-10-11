/**
 * Domain owner: app: WS2.
 *
 * Append new app events here. Do not rename existing events.
 */
import type { Verb, OnboardingFunnelStep, ActivationGoal, DecisionJourney } from './vocabulary.js';

export const APP_EVENT_NAMES = [
  'onboarding_step_viewed',
  'onboarding_step_completed',
  'activation_goal_selected',
  'first_relief_session_started',
  'action_preview_viewed',
  'action_confirmed',
  'first_relief_session_completed',
  'sender_unprotected',
  'triage_action_taken',
  'action_overdue',
  'undo_clicked',
  'unsubscribe_attempted',
  'rule_fired',
  'sender_detail_opened',
  'gmail_deep_link_opened',
  'compose_filter_changed',
  'bulk_select_in_filter',
  'bulk_action_taken',
  'confirm_action_modal_opened',
  'recent_subjects_expanded',
  'sender_search_submitted',
  'activity_filter_changed',
  'bulk_undo_clicked',
  'activity_support_bundle_exported',
  'csv_exported',
  'brief_refresh_clicked',
  'brief_cta_clicked',
  'autopilot_paused',
  'autopilot_resumed',
  'autopilot_suggestion_decided',
  'autopilot_preset_changed',
  'autopilot_pattern_suggestion_shown',
  'autopilot_pattern_suggestion_decided',
  'product_feedback_submitted',
  'weekly_review_viewed',
  'quiet_hours_updated',
  'followup_dismissed',
  'screener_queue_viewed',
  'screener_decision_taken',
  'snooze_set',
  'snooze_cleared',
  'wake_now_clicked',
  'settings_pref_changed',
  'brief_hour_changed',
  'data_export_requested',
  'support_request_submitted',
  'caught_up_viewed',
  'empty_state_cta_clicked',
  'sync_gate_state_viewed',
  'home_next_step_clicked',
] as const;

export type AppEventName = (typeof APP_EVENT_NAMES)[number];

export interface AppEventPayloads {
  onboarding_step_viewed: {
    step: OnboardingFunnelStep;
  };

  onboarding_step_completed: {
    step: OnboardingFunnelStep;
    duration_ms: number;
  };

  activation_goal_selected: {
    goal: ActivationGoal;
  };

  first_relief_session_started: {
    goal: ActivationGoal;
    target: number;
  };

  action_preview_viewed: {
    journey: DecisionJourney;
    verb: Verb;
  };

  action_confirmed: {
    journey: DecisionJourney;
    verb: Verb;
  };

  first_relief_session_completed: {
    goal: ActivationGoal;
    target: number;
    decided: number;
    outcome: 'completed' | 'stopped' | 'empty';
  };

  /**
   * A manual Unprotect — the sticky D245 override. This is the only
   * feedback loop on the automatic-protection thresholds (≥3 replies /
   * a star in a year / ≥3 Gmail-important in a year): which REASON gets
   * unprotected, and from which surface, is how a mistuned signal
   * shows up. Reason id + surface enum only — no sender identity.
   */
  sender_unprotected: {
    surface: 'onboarding-review' | 'triage-preview' | 'settings-senders' | 'sender-detail';
    reason: 'user_defined' | 'replied' | 'starred' | 'gmail_important' | null;
  };

  triage_action_taken: {
    verb: Verb;
    sender_id: string;
    /** True when the user's verb equals the engine's verdict for the row (D21/D29). */
    matched_recommendation: boolean;
    /** Messages requested at enqueue accept; -1 when not available. Never a terminal outcome. */
    requested_messages: number;
    source: 'sheet' | 'inline' | 'shortcut';
  };

  /**
   * A confirmed action outlived its overdue deadline client-side and
   * was parked (2026-08-12 incident class). Parking is the one moment
   * the client KNOWS a backend hang happened — this event is how
   * recurrence stays measurable. No sender identity.
   */
  action_overdue: {
    kind: 'single' | 'batch';
    verb: string;
  };

  undo_clicked: {
    /**
     * The reverted action's kind — mirrors the `undo_action_kind` pg
     * enum (kept inline so this file stays import-free). `apply-rule`
     * covers Autopilot reverts; the rest are KAULD verbs. No action_id
     * here: the FE only holds the undo TOKEN at click time, and a live
     * capability token must never reach telemetry.
     */
    verb: Verb | 'apply-rule';
    /** Age of the undo token at click — ms since the action landed. */
    age_ms: number;
  };

  unsubscribe_attempted: {
    sender_id: string;
    method: 'http' | 'mailto_draft' | 'manual';
    outcome: 'success' | 'failed' | 'queued';
  };

  rule_fired: {
    rule_id: string;
    rule_is_preset: boolean;
    verb: Verb;
    affected_messages: number;
  };

  sender_detail_opened: {
    sender_id: string;
    source: 'senders_grid' | 'senders_table' | 'activity_row' | 'brief_card' | 'search';
  };

  gmail_deep_link_opened: {
    /** What surface the link came from. */
    source:
      'recent_messages_row' | 'sender_detail_open_all' | 'senders_card_overflow' | 'activity_row';
    /** Which Gmail-link shape — single thread vs all-from-sender vs search. */
    deep_link_kind: 'thread' | 'all_from_sender' | 'search';
  };

  // — Senders V2 surface —
  compose_filter_changed: {
    axis: 'volume' | 'window' | 'domain' | 'replied' | 'protected' | 'sort';
    op: 'set' | 'cleared' | 'negated';
    /** Number of axes active AFTER this change (multi-axis support). */
    active_axes: number;
    mailbox_id: string;
    /** Saved launch filter, when the change came from one. */
    filter_id?: 'mostly_unread_90' | 'has_unsubscribe';
  };

  bulk_select_in_filter: {
    selected_count: number;
    /** Comma-joined active filter axes (e.g. `volume,window`). */
    filter_axes: string;
  };

  bulk_action_taken: {
    verb: Verb;
    selected_count: number;
    /** Messages requested at enqueue accept; -1 when not available. Never a terminal outcome. */
    requested_messages: number;
    // `triage_domain_batch` — the D32-scoped domain-batch card on
    // Triage (one composite decision over a same-domain run).
    source: 'senders_bulk_bar' | 'activity_bulk_bar' | 'confirm_modal' | 'triage_domain_batch';
  };

  confirm_action_modal_opened: {
    verb: Verb;
    sender_count: number;
    /** Was the modal opened against a single sender, a multi-select, or a bulk-in-filter? */
    invocation: 'single' | 'multi' | 'bulk_in_filter';
  };

  recent_subjects_expanded: {
    verb: Verb;
    sender_count: number;
    /** Which time-window bucket the user expanded. */
    bucket: '30d' | '90d' | '180d' | '365d' | 'all';
  };

  sender_search_submitted: {
    /** Length only — never the search text. */
    query_length: number;
    /** Did the user pick a suggestion or hit Enter on raw text? */
    submission_kind: 'enter' | 'suggestion';
    result_count: number;
  };

  // — Activity surface —
  activity_filter_changed: {
    filter: 'verb' | 'window' | 'date_range' | 'custom_search';
    /** Generic op enum — `set` covers most; `cleared` covers reset. */
    op: 'set' | 'cleared';
  };

  bulk_undo_clicked: {
    /** Number of action_ids the user attempted to revert in this click. */
    action_ids_count: number;
    /** Did all succeed, partial, or all fail? */
    outcome: 'all_success' | 'partial' | 'all_failed';
  };

  activity_support_bundle_exported: {
    outcome: 'success' | 'failed';
    full_sender_addresses: boolean;
    technical_details: boolean;
  };

  csv_exported: {
    surface: 'activity' | 'senders';
    row_count: number;
    /** Did the export include filter state, or was it the unfiltered table? */
    filtered: boolean;
  };

  // — Brief surface —
  brief_refresh_clicked: {
    mailbox_id: string;
  };

  brief_cta_clicked: {
    /** Which Brief CTA was clicked. */
    cta_kind: 'top_sender_open' | 'open_in_gmail' | 'review_session_start' | 'sender_detail_open';
    target: 'sender_detail' | 'gmail' | 'triage' | 'activity';
  };

  // — Autopilot surface —
  autopilot_paused: {
    duration_kind: '24h' | '7d' | 'until_resumed' | 'custom';
  };

  autopilot_resumed: {
    /** Was the resume manual or did the paused window expire? */
    trigger: 'manual' | 'window_expired';
  };

  autopilot_suggestion_decided: {
    /** Did the founder accept, reject, or snooze the suggestion? */
    decision: 'accepted' | 'rejected' | 'snoozed';
    /** Which suggestion category — preset, custom rule, sender-policy nudge. */
    suggestion_kind: 'preset_rule' | 'sender_policy' | 'preset_change';
    /**
     * How many suggestions this decision covered — 1 for a per-row
     * dismiss; for the D104 batch approves, the server's `approvedCount`
     * (a match skipped as Protected is not counted). Approve-all /
     * approve-selected fire ONE event per mutation, not per row, to
     * keep cardinality bounded like `rule_fired`.
     */
    count: number;
  };

  autopilot_preset_changed: {
    preset_id: string;
    /** `activated` = the explicit D104 Observe → Active switch (no auto-promote). */
    action: 'enabled' | 'disabled' | 'parameter_changed' | 'activated';
  };

  autopilot_pattern_suggestion_shown: {
    preset_key: 'auto_archive_low_engagement' | 'auto_unsubscribe_noisy';
    evidence_count: number;
  };

  autopilot_pattern_suggestion_decided: {
    preset_key: 'auto_archive_low_engagement' | 'auto_unsubscribe_noisy';
    decision: 'observe' | 'dismissed';
    evidence_count: number;
  };

  // — Calibrated feedback + review (D246) —
  product_feedback_submitted:
    | { surface: 'activity'; rating: 'expected' | 'surprising' }
    | { surface: 'brief'; rating: 'useful' | 'not_useful' | 'wrong_reason' }
    | { surface: 'followups'; rating: 'useful' | 'not_followup' };

  weekly_review_viewed: {
    completed: number;
    skipped: number;
    failed: number;
    recovered: number;
    protected: number;
  };

  // — Quiet hours (U18 — D92/D95) —
  quiet_hours_updated: {
    mailbox_id: string;
    /** Config state AFTER the save. */
    enabled: boolean;
    /** True when the saved window spans midnight (startLocal > endLocal). */
    crosses_midnight: boolean;
  };

  // — Followups surface —
  followup_dismissed: {
    /** Internal `followup_tracker.id` UUID — never the Gmail thread id. */
    followup_id: string;
    /** D85 age bucket the row sat in when dismissed. */
    priority: 'high' | 'medium' | 'low' | 'fresh';
    /** True when the BE reported an idempotent replay (D88 Phase-1 hint). */
    already_dismissed: boolean;
  };

  // — Screener surface (D71–D77) —
  screener_queue_viewed: {
    /**
     * Pending first-time senders when the queue rendered (D74 badge
     * figure). `null` when the count query hadn't resolved at render —
     * the loaded page size is never substituted for the total.
     */
    pending_count: number | null;
  };

  screener_decision_taken: {
    verb: Verb;
    /** Internal `senders.id` UUID — never the email address. */
    sender_id: string;
  };

  // — Snoozed surface (D78–D80, D82) —
  snooze_set: {
    sender_id: string;
    /** Which D82 preset was picked (`custom` = the date picker). */
    preset: 'later_today' | 'tomorrow' | 'weekend' | 'next_week' | 'next_month' | 'custom';
    /** Whether the user attached a note — never the note text. */
    has_reason: boolean;
  };

  snooze_cleared: {
    sender_id: string;
  };

  wake_now_clicked: {
    sender_id: string;
    /** Mirror count at click time; -1 when the count was still syncing. */
    later_count: number;
  };

  // — Settings surface (U23 — D34/D116/D216) —
  settings_pref_changed: {
    /** Which preference flipped. */
    pref: 'action_sheet_skip' | 'email_reminders' | 'email_sync_complete' | 'email_weekly_receipt';
    /**
     * The KAULD verb for `action_sheet_skip` flips; null for
     * non-verb-scoped email preferences.
     */
    verb: Verb | null;
    /** State AFTER the change — for skip prefs, true = sheet skipped. */
    enabled: boolean;
    /** Where the flip happened — settings card vs the sheet's remember toggle. */
    source: 'settings' | 'action_sheet';
  };

  /**
   * D64 — the Brief's local delivery hour was changed from Settings.
   * Separate from `settings_pref_changed`, which carries a boolean:
   * the question this answers is which hours people actually pick,
   * i.e. whether the picker earned its build.
   */
  brief_hour_changed: {
    /** Local hour chosen, 0-23. */
    hour: number;
  };

  data_export_requested: {
    /** Which export artifact was requested. */
    format: 'json' | 'csv' | 'senders-csv' | 'decisions-csv';
    /** Success means complete blob handed to the browser, not proof of a saved file. */
    outcome: 'success' | 'failed';
  };

  caught_up_viewed: {
    surface: 'senders' | 'triage' | 'home' | 'screener';
  };

  empty_state_cta_clicked: {
    surface: 'senders' | 'triage' | 'home' | 'screener' | 'activity';
    state: 'caught_up' | 'empty' | 'resting';
  };

  sync_gate_state_viewed: {
    state:
      | 'progress'
      | 'ready'
      | 'insufficient_scopes'
      | 'invalid_grant'
      | 'reconnect_required'
      | 'rate_limit'
      | 'stuck'
      | 'unknown';
  };

  home_next_step_clicked: {
    kind: 'unsubscribe_archive' | 'largest_senders' | 'later_due' | 'triage';
  };
}
