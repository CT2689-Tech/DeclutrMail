// apps/api/src/billing/billing-provider.interface.ts — the shared
// `BillingProvider` seam both adapters implement (D117).
//
// D117 locks the architecture: provider-specific code lives in
// `paddle.adapter.ts` / `razorpay.adapter.ts` behind this interface;
// everything above it (BillingService, BillingWebhookService, the
// controllers) is provider-agnostic. Webhook handlers normalize both
// providers into the single `subscription_events` stream — the
// `NormalizedBillingEvent` here is that normalization's in-memory
// shape.

import type {
  BillingCycle,
  BillingProviderId,
  CheckoutSession,
  PurchasableTier,
  SubscriptionStatus,
} from '@declutrmail/shared/contracts';

/** Input to `createCheckout` — already catalog-resolved by BillingService. */
export interface CreateCheckoutInput {
  workspaceId: string;
  /** Authed user's email — pre-fills provider checkout; never stored provider-side by us. */
  userEmail: string;
  tierId: PurchasableTier;
  cycle: BillingCycle;
  /** Provider-side catalog id (Paddle `pri_…` / Razorpay `plan_…`). */
  providerPriceId: string;
}

export type PlanChangeTiming =
  { kind: 'immediate_prorated' } | { kind: 'next_period_no_proration'; effectiveAt: string };

export interface PlanChangeResult {
  /** Price reported after applying the mutation; null when the response cannot confirm it. */
  providerPriceId: string | null;
  /** Provider mutation time, used to order delayed webhooks after local reconciliation. */
  providerUpdatedAt: string | null;
}

/**
 * The domain effect of one verified webhook event, normalized across
 * providers. `kind` drives the BillingWebhookService switch:
 *
 *   - `subscription` — upsert the subscription row + recompute the
 *     workspace tier (the only kind that flips entitlements).
 *   - `payment` — observability only (`billing_event` D159 log);
 *     subscription state arrives via its own `subscription` events.
 *   - `cancellation_scheduled` — refund/chargeback or provider-side
 *     scheduled cancel: set `cancel_at_period_end`, tier holds until
 *     period end (D118 semantics — documented in billing.module.ts).
 *   - `ignored` — recognized envelope, no domain effect. Recorded in
 *     `subscription_events` (audit) and marked processed.
 */
export type NormalizedBillingEvent =
  | {
      kind: 'subscription';
      providerEventId: string;
      eventType: string;
      subscription: NormalizedSubscription;
    }
  | {
      kind: 'payment';
      providerEventId: string;
      eventType: string;
      outcome: 'succeeded' | 'failed';
      /** Provider subscription id when the payment is subscription-linked. */
      providerSubscriptionId: string | null;
      /**
       * Attribution carried by the payment itself. A completed
       * transaction is the one event guaranteed to hold the customer id
       * AND the checkout's own `custom_data`/`notes`, so it seeds
       * `billing_customers` — giving subscription attribution a second
       * link instead of depending solely on the provider echoing
       * custom_data onto the subscription entity.
       */
      providerCustomerId: string | null;
      workspaceId: string | null;
    }
  | {
      kind: 'cancellation_scheduled';
      providerEventId: string;
      eventType: string;
      providerSubscriptionId: string;
      reason: 'refund' | 'chargeback' | 'provider_scheduled';
    }
  | {
      kind: 'ignored';
      providerEventId: string;
      eventType: string;
    };

/** Provider-agnostic subscription snapshot extracted from a webhook. */
export interface NormalizedSubscription {
  providerSubscriptionId: string;
  /** Provider customer id (`ctm_…` / `cust_…`); null when absent. */
  providerCustomerId: string | null;
  /** Provider price/plan id — resolved to tier/cycle via the catalog. */
  providerPriceId: string;
  status: SubscriptionStatus;
  /** ISO timestamp; null on terminal cancellation. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** D118 pause offer — set when status is `paused`. */
  pauseUntil: string | null;
  /**
   * Workspace attribution carried IN the provider payload (Paddle
   * `custom_data.workspace_id`, Razorpay `notes.workspace_id`). Used
   * on first contact; later events resolve via `billing_customers`.
   */
  workspaceId: string | null;
}

/** Outcome of webhook signature verification (D180/D229-bar). */
export type SignatureVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'malformed_header' | 'signature_mismatch' | 'timestamp_skew' };

/**
 * The D117 provider seam. One implementation per provider; both are
 * stateless (env + fetch only) so they unit-test against recorded
 * fixtures without network.
 */
export interface BillingProvider {
  readonly id: BillingProviderId;

  /**
   * Build the provider-specific checkout payload the FE consumes.
   * Paddle: pure (overlay token + price id, no API call). Razorpay:
   * creates the provider-side subscription (server-attributed notes).
   */
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;

  /** Cancel at period end (D118 — never immediate, no proration). */
  cancelSubscription(providerSubscriptionId: string): Promise<void>;

  /**
   * Switch the subscription to a different catalog price. Immediate
   * upgrades are prorated. For a scheduled downgrade the provider item
   * changes without billing, while the local scheduled-change state
   * keeps the old entitlement through `effectiveAt`.
   */
  changePlan(
    providerSubscriptionId: string,
    providerPriceId: string,
    timing: PlanChangeTiming,
  ): Promise<PlanChangeResult>;

  /**
   * Resume a paused subscription immediately. Entitlement returns via
   * the provider's `subscription.resumed`/`updated` webhook.
   */
  resumeSubscription(providerSubscriptionId: string): Promise<void>;

  /**
   * Verify the webhook signature against the RAW request body
   * (D180). Pure HMAC math — fail closed on any malformed input.
   */
  verifyWebhookSignature(args: {
    rawBody: Buffer;
    signatureHeader: string | undefined;
    secret: string;
    nowMs?: number;
  }): SignatureVerifyResult;

  /**
   * Map a verified webhook body to its normalized domain effect.
   * Returns `kind: 'ignored'` for recognized-but-irrelevant events;
   * throws only on envelopes missing the provider's documented
   * required fields (surfaces as 400 — provider stops retrying).
   */
  mapWebhookEvent(payload: unknown): NormalizedBillingEvent;
}
