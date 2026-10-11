/**
 * Shared event vocabulary. Import-free scalars used by every domain file.
 * Domain owner: shared (WS1a split). Do not rename these unions.
 */
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

export type ActivationGoal = 'reduce_newsletters' | 'protect_important' | 'clear_old_promotions';

export type DecisionJourney = 'first_relief' | 'daily';

export type PageSurface =
  | 'landing'
  | 'home'
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
  | 'billing'
  | 'screener'
  | 'followups'
  | 'quiet'
  | 'privacy'
  | 'terms'
  | 'refunds'
  | 'beta'
  | 'cookies'
  | 'help'
  | 'contact'
  | 'security'
  | 'inbox_simulator'
  | 'how_it_works'
  | 'methodology'
  | 'compare'
  | 'comparison'
  | 'how_to'
  | 'answer'
  | 'blog'
  | 'changelog'
  | 'faq'
  | 'sign_in';
