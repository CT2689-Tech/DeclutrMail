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
 * Read-only dry run of a plan change (D117/D120 upgrade-copy truth).
 * `result` is the provider's own "what happens right now" summary —
 * Paddle's `update_summary.result` — in the currency's lowest unit.
 * Null when the provider answered but the summary was absent/unparsable
 * (the caller falls back to generic copy, never to an invented number).
 */
export interface PlanChangePreviewResult {
  result: { action: 'charge' | 'credit'; amount: string; currencyCode: string } | null;
  /** Post-change next billing timestamp, when the provider reports it. */
  nextBilledAt: string | null;
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
      /**
       * A local verdict the PROVIDER has contradicted, and it must be
       * lifted. Without it the customer stays locked out permanently
       * while paying normally, with every self-serve exit shut — the
       * harshest outcome this system can produce (founder decision +
       * Codex stop-review, 2026-07-31).
       *
       * `chargeback_reverse` — the dispute was won, funds returned.
       * `refund_rejected`    — Paddle declined a refund we had already
       *                        acted on (live accounts create refunds
       *                        `pending_approval`; sandbox auto-approves,
       *                        so this shape never appears in testing).
       *
       * The reason names which verdict is void, and the handler lifts
       * only that one — a reversal must never clear a refund, and a
       * rejection must never clear a chargeback.
       */
      kind: 'cancellation_revoked';
      providerEventId: string;
      eventType: string;
      providerSubscriptionId: string;
      reason: 'chargeback_reverse' | 'refund_rejected';
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
  /**
   * Provider-side creation time (ISO), when the source carries it.
   * Consumed by pending-checkout reconciliation (D249) to refuse
   * candidates that predate the claim; webhook mappings may omit it.
   */
  providerCreatedAt?: string | null;
}

/** D249 — what a provider-truth subscription read actually found. */
export type FetchSubscriptionResult =
  | { kind: 'not_found' }
  | { kind: 'found'; subscription: NormalizedSubscription }
  /** Exists at the provider in a status our normalization does not
   *  map (pre-grant / unknown). Real activity — never "no payment". */
  | { kind: 'found_unmapped'; providerStatus: string };

/**
 * D249 — inputs to the claimless/hint subscription search. Each
 * provider uses the keys it can actually query by: Paddle looks
 * customers up by `email`; Razorpay lists by `providerPriceIds`
 * (plan_id filter) and matches the server-written `notes.workspace_id`
 * against `workspaceId` — its list API has no customer filter, and the
 * overlay-typed email may not even match the owner's (aliases).
 */
export interface SubscriptionSearchQuery {
  /** Authed workspace — matched against server-written attribution. */
  workspaceId: string;
  /** Workspace owner's email — Paddle's customer lookup key. */
  email: string;
  /** Catalog price/plan ids the wait could resolve to, THIS provider's. */
  providerPriceIds: string[];
  /** Only consider artifacts created at/after this instant (ISO). */
  createdAfter?: string | undefined;
}

export interface SubscriptionSearchResult {
  subscriptions: NormalizedSubscription[];
  /** Matching artifacts in pre-grant/unmapped statuses (3DS window) —
   *  real provider activity that must never read as "no payment". */
  inProgress: number;
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
   * Revoke a scheduled cancellation, putting the subscription back on
   * renewal (D118). The inverse of `cancelSubscription`, and the reason
   * it exists: without it a mis-click is irreversible for up to a year
   * — checkout refuses (`SUBSCRIPTION_EXISTS`) and change-plan refuses
   * (`SUBSCRIPTION_CANCELING`), so the only way back was an operator
   * with a provider API key (matrix E3, 2026-07-31).
   *
   * Touches the schedule only: the billing period, price and status are
   * unchanged, so nothing is charged and no entitlement moves.
   */
  clearScheduledCancellation(providerSubscriptionId: string): Promise<void>;

  /**
   * Pause billing now and auto-resume at `resumeAt` (D118's
   * pause-30-days offer). A paused subscription grants NOTHING, so the
   * entitlement drop arrives via the provider's `subscription.paused`
   * webhook rather than being written here — same rule as every other
   * grant/revoke.
   */
  pauseSubscription(providerSubscriptionId: string, resumeAt: string): Promise<void>;

  /**
   * Ask the PROVIDER whether it holds a settled, plan-ending refund or
   * chargeback for this subscription.
   *
   * Exists because a local `cancel_source` is not proof of a settled
   * one. On a live Paddle account a refund is created
   * `pending_approval` and Paddle decides later; sandbox auto-approves,
   * so the pending shape never appears in testing. Ending entitlement on
   * an unsettled refund costs a wrong local row we can fix. CANCELLING
   * AT THE PROVIDER on one cancels a customer who may still be paying —
   * so the outbound step tests the fact instead of trusting our own
   * marker (Codex stop-review, 2026-07-31).
   *
   *   'refund' | 'chargeback' — settled; the subscription must not renew
   *   'none'    — nothing settled YET (a refund still pending approval).
   *               Take no outbound action and change nothing locally.
   *   'refuted' — the provider's records CONTRADICT our marker: the
   *               refund was rejected, or the chargeback reversed. The
   *               local verdict is void and must be lifted, or a paying
   *               customer sits on Free with no self-serve way out.
   *   'unknown' — could not ask. Take no action either way; a read
   *               failure is never grounds for a write.
   *
   * The `refuted` answer is what lets the correction run WITHOUT
   * depending on `adjustment.updated` being subscribed at the provider —
   * an ops setting we cannot verify from here.
   */
  settledCancellationCause(
    providerSubscriptionId: string,
  ): Promise<'refund' | 'chargeback' | 'none' | 'refuted' | 'unknown'>;

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
   * Preview `changePlan` without applying it — the provider computes
   * the immediate proration so the confirm panel can show the exact
   * charge instead of "a prorated difference" (D117/D120). Read-only;
   * throws `BILLING_PROVIDER_ERROR` on network/5xx like the reads.
   */
  previewPlanChange(
    providerSubscriptionId: string,
    providerPriceId: string,
    timing: PlanChangeTiming,
  ): Promise<PlanChangePreviewResult>;

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

  /**
   * D249 reconciliation reads — the interface's only provider-truth
   * GETs. Both throw `BILLING_PROVIDER_ERROR` on network/5xx (the
   * reconciler maps that to `provider_unavailable`, writes nothing).
   *
   * `fetchSubscription` distinguishes three answers because they mean
   * three different things to a pending checkout: `not_found` (provider
   * 404 — nothing exists), `found` (a mappable subscription), and
   * `found_unmapped` (the subscription EXISTS in a status we do not
   * map — Razorpay `created`/`authenticated` is the 3DS-in-flight
   * window). Collapsing the last into `not_found` told users "no
   * payment found" seconds before a charge settled (Codex 2026-07-30).
   */
  fetchSubscription(providerSubscriptionId: string): Promise<FetchSubscriptionResult>;

  /**
   * Subscriptions attributable to this workspace, for reconciles with
   * no usable `provider_ref` — Paddle claims never carry one, and a
   * stale lock may outlive the claim row entirely (Codex 2026-07-30:
   * the "Razorpay always has provider_ref" assumption died exactly
   * there). Each adapter searches by what its API supports; see
   * SubscriptionSearchQuery.
   */
  searchSubscriptions(query: SubscriptionSearchQuery): Promise<SubscriptionSearchResult>;
}
