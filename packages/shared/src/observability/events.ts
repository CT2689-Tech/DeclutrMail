/**
 * Closed union of PostHog event names (D159).
 *
 * Adding a new event requires:
 * 1. Append the literal here.
 * 2. Document name, trigger, payload shape, retention in
 *    `docs/observability/event-taxonomy.md`.
 * 3. (Optional) Add a discriminated entry to `EventPayloads` if the
 *    event ships structured properties.
 *
 * Keeping this union closed means typos at call sites become compile
 * errors — there are no accidental new event names in production.
 */
export type EventName =
  // — Onboarding + sync —
  | 'onboarding_step_viewed'
  | 'onboarding_step_completed'
  | 'sync_started'
  | 'sync_completed'
  | 'sync_now_clicked'
  // — Triage + action lifecycle —
  | 'triage_action_taken'
  | 'undo_clicked'
  | 'unsubscribe_attempted'
  | 'rule_fired'
  | 'billing_event'
  | 'upgrade_prompt_shown'
  // — Billing surface (D119/D120, U13) —
  | 'checkout_started'
  // — Page-view + navigation funnel (FOUNDER-FOLLOWUPS 2026-06-06) —
  | 'page_viewed'
  | 'sender_detail_opened'
  | 'gmail_deep_link_opened'
  // — Marketing landing funnel (D134) —
  | 'landing_cta_clicked'
  // — Senders V2 surface —
  | 'compose_filter_changed'
  | 'bulk_select_in_filter'
  | 'bulk_action_taken'
  | 'confirm_action_modal_opened'
  | 'recent_subjects_expanded'
  | 'sender_search_submitted'
  // — Activity surface —
  | 'activity_filter_changed'
  | 'bulk_undo_clicked'
  | 'csv_exported'
  // — Brief surface —
  | 'brief_refresh_clicked'
  | 'brief_cta_clicked'
  // — Autopilot surface —
  | 'autopilot_paused'
  | 'autopilot_resumed'
  | 'autopilot_suggestion_decided'
  | 'autopilot_preset_changed'
  // — Quiet hours (U18 — D92/D95) —
  | 'quiet_hours_updated'
  // — Marketing surface (D19 pricing) —
  | 'waitlist_joined'
  // — Followups surface —
  | 'followup_dismissed'
  // — Screener surface (D71–D77) —
  | 'screener_queue_viewed'
  | 'screener_decision_taken'
  // — Private-beta gate (buildout F7) —
  | 'beta_gate_denied'
  // — Snoozed surface (D78–D80, D82) —
  | 'snooze_set'
  | 'snooze_cleared'
  | 'wake_now_clicked'
  // — Settings surface (U23 — D34/D116/D216) —
  | 'settings_pref_changed'
  | 'data_export_requested';

/**
 * Canonical KAULD verb union. Mirrors the verb-registry literal in
 * `packages/shared/src/actions/verb-registry.ts` so PostHog props stay
 * compile-safe when a new verb lands.
 */
export type Verb = 'keep' | 'archive' | 'unsubscribe' | 'later' | 'delete';

/**
 * The D106 onboarding funnel stages, in flow order. `promise` is the
 * pre-auth value screen (D107); the remaining five match the original
 * D159 taxonomy entry. Used by both the step_viewed and step_completed
 * events so the funnel insight joins on one union.
 */
export type OnboardingFunnelStep =
  'promise' | 'connect_gmail' | 'sync_gate' | 'choose_preset' | 'first_triage' | 'finished';

/**
 * Per-event payload shapes. Only includes scalars and small enums —
 * NEVER email content, addresses, or anything privacy-banned.
 *
 * Convention: identifiers are internal UUIDs (sender_id, user_id from
 * our DB), never Gmail message IDs or raw email addresses.
 */
export interface EventPayloads {
  onboarding_step_viewed: {
    step: OnboardingFunnelStep;
  };
  onboarding_step_completed: {
    step: OnboardingFunnelStep;
    duration_ms: number;
  };
  sync_started: {
    sync_id: string;
    mailbox_id: string;
    trigger: 'initial' | 'manual' | 'pubsub' | 'cron';
  };
  sync_completed: {
    sync_id: string;
    mailbox_id: string;
    messages_indexed: number;
    duration_ms: number;
    outcome: 'success' | 'partial' | 'failed';
  };
  sync_now_clicked: {
    mailbox_id: string;
    source: 'app_shell' | 'senders' | 'activity' | 'brief' | 'sender_detail';
  };
  triage_action_taken: {
    verb: Verb;
    sender_id: string;
    affected_messages: number;
    source: 'sheet' | 'inline' | 'shortcut';
  };
  undo_clicked: {
    action_id: string;
    verb: Verb;
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
  billing_event: {
    kind:
      | 'subscription_created'
      | 'subscription_updated'
      | 'subscription_canceled'
      | 'payment_succeeded'
      | 'payment_failed';
    tier: 'free' | 'plus' | 'pro';
  };
  upgrade_prompt_shown: {
    /** Which entitlement gate triggered the prompt (D19/D77/D81). */
    reason: 'free_cap' | 'inbox_limit' | 'pro_feature';
    /** The surface that rendered it. */
    source: 'actions_402' | 'account_menu' | 'triage_empty_state' | 'upgrade_modal' | 'tier_gate';
  };

  // — Billing surface (D119/D120, U13) —
  checkout_started: {
    /** Purchasable target tier (D19). */
    tier: 'plus' | 'pro';
    cycle: 'monthly' | 'annual';
    /** D117 — user's explicit provider choice. */
    provider: 'paddle' | 'razorpay';
    /** True when the Founding Pro promo price was claimed (D126). */
    founding_pro: boolean;
  };

  // — Page-view + navigation funnel —
  page_viewed: {
    page:
      | 'landing'
      | 'senders'
      | 'sender_detail'
      | 'activity'
      | 'brief'
      | 'autopilot'
      | 'triage'
      | 'onboarding'
      | 'settings'
      | 'mailboxes'
      | 'pricing'
      | 'snoozed'
      | 'billing';
    mailbox_id: string | null;
  };

  // — Marketing landing funnel (D134) —
  landing_cta_clicked: {
    /** Which CTA — `connect_gmail` starts OAuth; `open_app` is the authed shortcut. */
    cta: 'connect_gmail' | 'open_app' | 'see_pricing';
    /** Where on the landing page the click happened. */
    placement: 'nav' | 'hero' | 'pricing_teaser' | 'final';
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
  };
  bulk_select_in_filter: {
    selected_count: number;
    /** Comma-joined active filter axes (e.g. `volume,window`). */
    filter_axes: string;
  };
  bulk_action_taken: {
    verb: Verb;
    selected_count: number;
    /** Sender count vs message count breakdown — KAULD-aware. */
    affected_messages: number;
    source: 'senders_bulk_bar' | 'activity_bulk_bar' | 'confirm_modal';
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
     * dismiss, N for the D104 batch approves (approve-all /
     * approve-selected fire ONE event per mutation, not per row, to
     * keep cardinality bounded like `rule_fired`).
     */
    count: number;
  };
  autopilot_preset_changed: {
    preset_id: string;
    /** `activated` = the explicit D104 Observe → Active switch (no auto-promote). */
    action: 'enabled' | 'disabled' | 'parameter_changed' | 'activated';
  };

  // — Quiet hours (U18 — D92/D95) —
  quiet_hours_updated: {
    mailbox_id: string;
    /** Config state AFTER the save. */
    enabled: boolean;
    /** True when the saved window spans midnight (startLocal > endLocal). */
    crosses_midnight: boolean;
  };

  // — Marketing surface (D19 pricing) —
  waitlist_joined: {
    /**
     * D19 tier the visitor expressed interest in; null for generic
     * forms. Mirrors `TierId` — kept inline so this file stays
     * import-free.
     */
    tier_interest: 'free' | 'plus' | 'pro' | 'team' | 'enterprise' | null;
    /** App-chosen attribution slug (`pricing`, `landing`, …) — NEVER the email. */
    source: string;
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
    /** Pending first-time senders when the queue rendered (D74 badge figure). */
    pending_count: number;
  };
  screener_decision_taken: {
    verb: Verb;
    /** Internal `senders.id` UUID — never the email address. */
    sender_id: string;
  };

  // — Private-beta gate (buildout F7) —
  beta_gate_denied: {
    /** What surfaced the denial — only the OAuth-callback redirect today. */
    source: 'oauth_callback';
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
    pref: 'action_sheet_skip' | 'email_reminders';
    /**
     * The KAULD verb for `action_sheet_skip` flips; null for
     * non-verb-scoped prefs (`email_reminders`).
     */
    verb: Verb | null;
    /** State AFTER the change — for skip prefs, true = sheet skipped. */
    enabled: boolean;
    /** Where the flip happened — settings card vs the sheet's remember toggle. */
    source: 'settings' | 'action_sheet';
  };
  data_export_requested: {
    /** Which export artifact was downloaded. */
    format: 'json' | 'csv';
    /** Terminal client-side outcome of the download attempt. */
    outcome: 'success' | 'failed';
  };
}

/**
 * Helper type that resolves the payload for a given event name.
 * Used by the `track()` wrapper to enforce payload shape at call sites.
 */
export type EventProps<E extends EventName> = E extends keyof EventPayloads
  ? EventPayloads[E]
  : Record<string, never>;
