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
  | 'onboarding_step_completed'
  | 'sync_started'
  | 'sync_completed'
  | 'triage_action_taken'
  | 'undo_clicked'
  | 'unsubscribe_attempted'
  | 'rule_fired'
  | 'billing_event';

/**
 * Per-event payload shapes. Only includes scalars and small enums —
 * NEVER email content, addresses, or anything privacy-banned.
 *
 * Convention: identifiers are internal UUIDs (sender_id, user_id from
 * our DB), never Gmail message IDs or raw email addresses.
 */
export interface EventPayloads {
  onboarding_step_completed: {
    step: 'connect_gmail' | 'choose_preset' | 'sync_gate' | 'first_triage' | 'finished';
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
  triage_action_taken: {
    verb: 'keep' | 'archive' | 'unsubscribe' | 'later';
    sender_id: string;
    affected_messages: number;
    source: 'sheet' | 'inline' | 'shortcut';
  };
  undo_clicked: {
    action_id: string;
    verb: 'keep' | 'archive' | 'unsubscribe' | 'later';
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
    verb: 'keep' | 'archive' | 'unsubscribe' | 'later';
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
}

/**
 * Helper type that resolves the payload for a given event name.
 * Used by the `track()` wrapper to enforce payload shape at call sites.
 */
export type EventProps<E extends EventName> = E extends keyof EventPayloads
  ? EventPayloads[E]
  : Record<string, never>;
