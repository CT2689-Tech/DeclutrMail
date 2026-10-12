import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { EVENT_NAMES } from './events/index';
import { OPS_SUPER_PROPERTIES } from './events/ops';

/**
 * Names in `events.ts` immediately before the domain split. That set
 * stays a subset. A5 names are an explicit addition — no renames, no drops.
 */
const A5_EVENT_NAMES = [
  'upgrade_cta_clicked',
  'checkout_closed',
  'free_cap_hit',
  'pass_selected',
  'plus_selected',
] as const;
const EVENT_NAMES_BEFORE_SPLIT = [
  'onboarding_step_viewed',
  'onboarding_step_completed',
  'activation_goal_selected',
  'first_relief_session_started',
  'action_preview_viewed',
  'action_confirmed',
  'first_relief_session_completed',
  'sync_started',
  'sync_completed',
  'sync_now_clicked',
  'sender_unprotected',
  'triage_action_taken',
  'action_overdue',
  'undo_clicked',
  'unsubscribe_attempted',
  'rule_fired',
  'billing_event',
  'upgrade_prompt_shown',
  'checkout_started',
  'checkout_session_created',
  'checkout_failed',
  'checkout_overlay_completed',
  'checkout_overlay_closed',
  'checkout_overlay_blocked',
  'plan_change_started',
  'page_viewed',
  'web_vital_reported',
  'sender_detail_opened',
  'gmail_deep_link_opened',
  'landing_cta_clicked',
  'demo_preview_opened',
  'demo_decision_confirmed',
  'demo_completed',
  'demo_reset',
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
  'pricing_plan_selected',
  'waitlist_joined',
  'followup_dismissed',
  'screener_queue_viewed',
  'screener_decision_taken',
  'beta_gate_denied',
  'snooze_set',
  'snooze_cleared',
  'wake_now_clicked',
  'settings_pref_changed',
  'brief_hour_changed',
  'data_export_requested',
  'support_request_submitted',
] as const;

const OWNERS = {
  billing: 'billing: WS1',
  app: 'app: WS2',
  report: 'report: WS5',
  growth: 'growth: WS3',
  ops: 'ops: WS4',
} as const;

/** Names appended after the split. Drops and renames still fail. */
const APPENDED_AFTER_SPLIT = [
  ...A5_EVENT_NAMES,
  'caught_up_viewed',
  'empty_state_cta_clicked',
  'sync_gate_state_viewed',
  'home_next_step_clicked',
  'brief_ai_consent_shown',
  'brief_ai_consent_decided',
  'brief_ai_consent_revoked',
  'provider_waitlist_joined',
] as const;

describe('event registry domain split', () => {
  it('keeps every pre-split name and only the named additions', () => {
    expect([...EVENT_NAMES].sort()).toEqual(
      [...EVENT_NAMES_BEFORE_SPLIT, ...APPENDED_AFTER_SPLIT].sort(),
    );
    expect(new Set(EVENT_NAMES).size).toBe(
      EVENT_NAMES_BEFORE_SPLIT.length + APPENDED_AFTER_SPLIT.length,
    );
  });

  it('keeps display_mode off the event-name list', () => {
    expect(OPS_SUPER_PROPERTIES).toEqual(['display_mode']);
    expect(EVENT_NAMES).not.toContain('display_mode');
  });

  it('names the owning workstream at the top of each domain file', () => {
    for (const [domain, owner] of Object.entries(OWNERS)) {
      const text = readFileSync(new URL(`./events/${domain}.ts`, import.meta.url), 'utf8');
      expect(text.split('\n').slice(0, 6).join('\n')).toContain(owner);
    }
  });
});
