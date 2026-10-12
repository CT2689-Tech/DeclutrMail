/**
 * Domain owner: billing: WS1.
 *
 * Append new billing events here. Do not rename existing events.
 */
export const BILLING_EVENT_NAMES = [
  'billing_event',
  'upgrade_prompt_shown',
  'checkout_started',
  'checkout_session_created',
  'checkout_failed',
  'checkout_overlay_completed',
  'checkout_overlay_closed',
  'checkout_overlay_blocked',
  'plan_change_started',
  'pricing_plan_selected',
  'waitlist_joined',
  'upgrade_cta_clicked',
  'checkout_closed',
  'free_cap_hit',
  'pass_selected',
  'plus_selected',
] as const;

export type BillingEventName = (typeof BILLING_EVENT_NAMES)[number];

export interface BillingEventPayloads {
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
    reason: 'free_cap' | 'inbox_limit' | 'action_tier' | 'feature_tier' | 'pro_feature';
    /** The surface that rendered it. */
    source: 'account_menu' | 'upgrade_modal' | 'tier_gate';
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

  /**
   * POST /api/billing/checkout returned a session. The server claim
   * (`pending_checkouts`) is written before this response, so this event
   * is the client-visible proof the row existed — not that the overlay
   * opened or that a payment completed.
   */
  checkout_session_created: {
    tier: 'plus' | 'pro';
    cycle: 'monthly' | 'annual';
    provider: 'paddle' | 'razorpay';
    founding_pro: boolean;
  };

  /**
   * POST /api/billing/checkout failed. `code` is the envelope error code
   * when present, else `unknown`. Does not mean a charge happened.
   */
  checkout_failed: {
    tier: 'plus' | 'pro';
    cycle: 'monthly' | 'annual';
    provider: 'paddle' | 'razorpay';
    founding_pro: boolean;
    code: string;
  };

  /**
   * Provider overlay reported payment complete. The tier still flips
   * only via the webhook — this is overlay truth, not a grant.
   */
  checkout_overlay_completed: {
    tier: 'plus' | 'pro';
    cycle: 'monthly' | 'annual';
    provider: 'paddle' | 'razorpay';
    founding_pro: boolean;
  };

  /**
   * Overlay dismissed without a completed event. Not proof of no
   * payment (popup / 3DS edges).
   */
  checkout_overlay_closed: {
    tier: 'plus' | 'pro';
    cycle: 'monthly' | 'annual';
    provider: 'paddle' | 'razorpay';
    founding_pro: boolean;
  };

  /**
   * Provider script failed to load after a session already existed.
   * The server claim is held.
   */
  checkout_overlay_blocked: {
    tier: 'plus' | 'pro';
    cycle: 'monthly' | 'annual';
    provider: 'paddle' | 'razorpay';
    founding_pro: boolean;
  };

  /** D117/D120 — self-serve plan change on the existing subscription. */
  plan_change_started: {
    /** Purchasable target tier (D19). */
    tier: 'plus' | 'pro';
    cycle: 'monthly' | 'annual';
    /** Entitlement tier the change started from. */
    from_tier: 'free' | 'plus' | 'pro' | 'team' | 'enterprise';
  };

  pricing_plan_selected: {
    tier: 'free' | 'plus' | 'pro';
    cycle: 'monthly' | 'annual';
    promo: 'foundingPro' | null;
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

  upgrade_cta_clicked: {
    source: string;
    plan: 'plus' | 'pass' | 'pro';
  };
  checkout_closed: {
    plan: 'plus' | 'pass' | 'pro';
  };
  free_cap_hit: {
    requested: number;
    remaining: number;
  };
  pass_selected: {
    source: string;
  };
  plus_selected: {
    source: string;
  };
}
