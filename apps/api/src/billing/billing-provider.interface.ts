// apps/api/src/billing/billing-provider.interface.ts — the
// `BillingProvider` seam the Paddle adapter implements (D117).
//
// Provider-specific code lives in `paddle.adapter.ts` behind this
// interface; everything above it (BillingService, BillingWebhookService,
// the controllers) is provider-agnostic. The webhook handler normalizes
// provider events into the single `subscription_events` stream — the
// `NormalizedBillingEvent` here is that normalization's in-memory
// shape.

import type {
  BillingCycle,
  BillingProviderId,
  CheckoutSession,
  PurchasableTier,
  SubscriptionStatus,
} from '@declutrmail/shared/contracts';
import type { PaddleCheckoutCode } from '@declutrmail/shared/entitlements';

/** Input to `createCheckout` — already catalog-resolved by BillingService. */
export interface CreateCheckoutInput {
  workspaceId: string;
  checkoutAttemptId?: string;
  checkoutOffer?: 'pass_onetime';
  /** Authed user's email — pre-fills provider checkout; never stored provider-side by us. */
  userEmail: string;
  tierId: PurchasableTier;
  cycle: BillingCycle;
  /** Provider-side catalog id (Paddle `pri_…`). */
  providerPriceId: string;
  /**
   * Country from the verified checkout-geo token. Null unless that
   * token checked out. Never the request body.
   */
  trustedCountry?: string | null;
  /** Launch Plus annual or Pass can select an India price. Anything else stays USD. */
  checkoutCode?: PaddleCheckoutCode;
}

export type PlanChangeTiming =
  | { kind: 'immediate_prorated'; upgradeIntent?: { id: string; workspaceId: string } }
  | { kind: 'next_period_no_proration'; effectiveAt: string };

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
      /** Synthetic verified policy restoration, never browser supplied. */
      upgradeRefundRestoration?: { intentId: string; adjustmentId: string };
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
      checkoutAttemptId?: string | null;
      checkoutPriceIds?: string[];
      checkoutItemsValid?: boolean;
      checkoutCurrencyCode?: string | null;
      /** Set on a one-off transaction. Subscription payments leave this unset. */
      providerTransactionId?: string | null;
      /** Price ids on a one-off transaction. Empty when the payment is subscription-linked. */
      oneTimePriceIds?: string[];
    }
  | {
      kind: 'pass_revoked';
      providerEventId: string;
      eventType: string;
      providerTransactionId: string;
      reason: 'refund' | 'chargeback';
    }
  | {
      kind: 'cancellation_scheduled';
      providerEventId: string;
      eventType: string;
      providerSubscriptionId: string;
      reason: 'refund' | 'chargeback' | 'provider_scheduled';
      refundReference?: { adjustmentId: string; transactionId: string };
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
      refundReference?: { adjustmentId: string; transactionId: string };
    }
  | {
      /**
       * The provider has CONFIRMED a refund settled, so the local row
       * stops being the workspace's live subscription (D253).
       *
       * A full refund already ends entitlement the moment it lands
       * (`entitlement_ends_at = now()`), but leaves `status='active'` —
       * and the checkout guard, the `subscriptions_one_live_per_workspace`
       * index and the frontend plan picker all read `active` as "this
       * workspace already has a subscription". So a refunded customer
       * held nothing AND could not buy again until the period they had
       * already paid for elapsed: up to a month, up to a year on annual.
       *
       * Flipping to `canceled` frees all three at once, because all three
       * already exclude `canceled`.
       *
       * SYNTHETIC — minted by reconciliation, never by a provider
       * payload. It is deliberately its own kind rather than a forged
       * `subscription` snapshot carrying `status:'canceled'`: forging one
       * would record in `subscription_events` that the provider reported
       * terminal cancellation when it did not. That is the same
       * assert-what-you-don't-know defect this codebase keeps relearning,
       * moved into the audit trail where it is harder to see.
       *
       * Refunds only. A settled CHARGEBACK deliberately does not mint
       * this — that customer stays blocked until the period ends
       * naturally (founder decision, 2026-08-13: under a merchant of
       * record, re-arming the same payment method same-day is how a
       * seller account gets flagged).
       */
      kind: 'refund_settled';
      providerEventId: string;
      eventType: string;
      providerSubscriptionId: string;
      refundReference?: { adjustmentId: string; transactionId: string };
    }
  | {
      kind: 'ignored';
      providerEventId: string;
      eventType: string;
    };

/** Provider-agnostic subscription snapshot extracted from a webhook. */
export interface NormalizedSubscription {
  checkoutAttemptId?: string;
  providerSubscriptionId: string;
  /** Provider customer id (`ctm_…`); null when absent. */
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
   * `custom_data.workspace_id`). Used on first contact; later events
   * resolve via `billing_customers`.
   */
  workspaceId: string | null;
  /**
   * Provider-side creation time (ISO), when the source carries it.
   * Consumed by pending-checkout reconciliation (D249) to refuse
   * candidates that predate the claim; webhook mappings may omit it.
   */
  providerCreatedAt?: string | null;
  /** Raw pre-payment/trial states must not allocate a NEW Founding seat.
   * Optional for older synthetic projections during a rolling deployment. */
  foundingAllocationEligible?: boolean;
}

/** D249 — what a provider-truth subscription read actually found. */
export type FetchSubscriptionResult =
  | { kind: 'not_found' }
  | { kind: 'found'; subscription: NormalizedSubscription }
  /** Exists at the provider in a status our normalization does not
   *  map (pre-grant / unknown). Real activity — never "no payment". */
  | { kind: 'found_unmapped'; providerStatus: string };

/**
 * What the provider's OWN record of one checkout transaction says about
 * whether it can still turn into a payment. Read-only: nothing here
 * cancels, edits or retries anything (ADR-0046 leaves provider-side
 * cancellation unapproved outside the sandbox).
 *
 *   - `unpaid`   the transaction exists, belongs to this workspace, has
 *                not been paid, and shows NO payment attempt that is
 *                still moving. The only answer that may support "no
 *                payment found" — and only for THIS transaction.
 *   - `stopped`  the provider canceled it; it can never be paid.
 *   - `paid`     captured, or already attached to a subscription.
 *   - `in_flight` a payment attempt exists that is not finished (3DS,
 *                a bank or wallet still deciding, an authorization not
 *                yet captured). Real activity — never "no payment".
 *   - `unknown`  anything we cannot classify with certainty: a status
 *                or attempt state we do not recognise, a missing
 *                attempts list, a mismatched id or workspace, a 404.
 *                Absence of evidence — it supports no claim either way.
 */
export type CheckoutHold = 'unpaid' | 'stopped' | 'paid' | 'in_flight' | 'unknown';

/**
 * Optional on `BillingProvider` because only some rails create a
 * transaction we can name before payment. A provider without it is
 * simply never "exact".
 */
export interface CheckoutHoldReader {
  fetchCheckoutHold(transactionId: string, workspaceId: string): Promise<CheckoutHold>;
}

/**
 * D249 — inputs to the claimless/hint subscription search. Paddle looks
 * customers up by `email`.
 */
export interface SubscriptionSearchQuery {
  /** Workspace owner's email — Paddle's customer lookup key. */
  email: string;
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
 * The D117 provider seam. The implementation is stateless (env + fetch
 * only) so it unit-tests against recorded fixtures without network.
 */
/**
 * What the PROVIDER's own records say about ending this subscription —
 * the second fact behind every outbound cancel, and the only thing that
 * may lift a local verdict.
 */
export interface ProviderCancellationFacts {
  /**
   * A settled, plan-ending adjustment exists, so the subscription must
   * not renew. Outranks `refuted`: a live chargeback beside an old
   * reversed one still ends the plan.
   */
  settled: 'refund' | 'chargeback' | null;
  /**
   * Verdicts the provider POSITIVELY CONTRADICTS — a refund it rejected
   * or reversed, a chargeback it reversed. Only the matching local
   * `cancel_source` may be lifted; a contradiction of the OTHER kind
   * says nothing about ours. A verdict that is merely unsettled (a
   * refund still pending approval) appears in neither field.
   */
  refuted: { refund: boolean; chargeback: boolean };
  /** Full adjustments on upgrade-only transactions never end the base plan. */
  upgradeRefunds?: Array<{ adjustmentId: string; transactionId: string; status: string }>;
}

export interface BillingProvider {
  readonly id: BillingProviderId;

  /** Build the provider-specific checkout payload the FE consumes. */
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
   * `null` means the provider could not be asked — never "nothing is
   * settled". A read failure is not grounds for any write.
   *
   * Reported PER VERDICT rather than as one verdict-shaped answer,
   * because a subscription can carry both kinds and they are independent
   * facts. An earlier revision collapsed refutation to a single boolean
   * and let the CALLER guess which verdict it referred to from its own
   * row — so a reversed chargeback lifted a refund verdict that Paddle
   * had never rejected (Codex stop-review, 2026-07-31).
   *
   * Asking the provider is also what lets the correction run WITHOUT
   * `adjustment.updated` being subscribed — an ops setting we cannot
   * verify from here.
   */
  providerCancellationFacts(
    providerSubscriptionId: string,
  ): Promise<ProviderCancellationFacts | null>;

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
   * throws on envelopes missing the provider's documented required
   * fields (surfaces as 400 — provider stops retrying) and on a
   * provider read this mapping needed but could not make (surfaces as
   * 5xx — the delivery stays in the provider's retry queue).
   *
   * MAY BE ASYNCHRONOUS. Paddle's mapper is pure — its payloads carry
   * `subscription_id` inline — and its signature still says so. Adding
   * an outbound call to a mapper that declares itself synchronous is
   * therefore a visible signature change, not a quiet edit. Callers
   * `await` either way; awaiting a non-promise costs a microtask.
   */
  mapWebhookEvent(payload: unknown): NormalizedBillingEvent | Promise<NormalizedBillingEvent>;

  /**
   * D249 reconciliation reads — the interface's only provider-truth
   * GETs. Both throw `BILLING_PROVIDER_ERROR` on network/5xx (the
   * reconciler maps that to `provider_unavailable`, writes nothing).
   *
   * `fetchSubscription` distinguishes three answers because they mean
   * three different things to a pending checkout: `not_found` (provider
   * 404 — nothing exists), `found` (a mappable subscription), and
   * `found_unmapped` (the subscription EXISTS in a status we do not
   * map). Collapsing the last into `not_found` told users "no payment
   * found" seconds before a charge settled (Codex 2026-07-30).
   */
  fetchSubscription(providerSubscriptionId: string): Promise<FetchSubscriptionResult>;

  /**
   * Subscriptions attributable to this workspace, for reconciles with
   * no usable `provider_ref` — a Paddle claim's ref names a
   * transaction, not a subscription, and a stale lock may outlive the
   * claim row entirely (Codex 2026-07-30). See SubscriptionSearchQuery.
   */
  searchSubscriptions(query: SubscriptionSearchQuery): Promise<SubscriptionSearchResult>;

  /**
   * Exact, read-only answer for the one transaction the server created
   * for a checkout (see CheckoutHold). Throws `BILLING_PROVIDER_ERROR`
   * on network/5xx, which the reconciler maps to `provider_unavailable`.
   */
  fetchCheckoutHold?: CheckoutHoldReader['fetchCheckoutHold'];

  /**
   * D119 / ADR-0035 — the provider's self-serve payment-method surface.
   *
   * The URL is short-lived and customer-specific — minted per call,
   * never cached or persisted. Throws `BILLING_PROVIDER_ERROR` on
   * network/5xx or a 200 with no usable URL.
   */
  paymentMethodSession(input: PaymentMethodSessionInput): Promise<PaymentMethodSessionResult>;

  /**
   * D119 / ADR-0035 — the subscription's billing documents, newest
   * first, proxied on read and never persisted.
   *
   * Amounts come back in the currency's LOWEST unit (the existing
   * provider-money convention). A status this adapter cannot map stays
   * `'unknown'` rather than being rounded to `paid` — the provider's
   * status vocabulary is wider than the normalized enum, and guessing
   * would assert something the read did not say.
   *
   * Throws `BILLING_PROVIDER_ERROR` on network/5xx: the caller reports
   * the rail as unavailable rather than serving a silently short list.
   */
  listInvoices(providerSubscriptionId: string): Promise<ProviderInvoicePage>;

  /** Provider-owned history for a server-resolved workspace customer, including one-time payments. */
  listCustomerInvoices(providerCustomerId: string): Promise<ProviderInvoicePage>;

  /**
   * D119 / ADR-0035 — mint a document URL for one invoice, per click.
   *
   * `null` means the provider answered 404 for this invoice; the caller
   * reports NOT_FOUND. The FE only calls this for rows that advertised
   * `documentAvailable: true`.
   */
  invoiceDocumentUrl(invoiceId: string): Promise<string | null>;
}

/**
 * Input to `paymentMethodSession`. Paddle's portal session is
 * CUSTOMER-scoped and takes the subscription only to deep-link the
 * right row. Neither id may be inferred from the other.
 */
export interface PaymentMethodSessionInput {
  providerCustomerId: string;
  providerSubscriptionId: string;
}

export interface PaymentMethodSessionResult {
  kind: 'url';
  url: string;
}

/**
 * One page of billing documents.
 *
 * `truncated` exists so a capped read cannot pass for a complete
 * history. The adapter asks for a single large page; when the provider
 * reports more rows behind it, that fact reaches the UI rather than
 * being dropped — a list that silently omits older invoices is worse
 * than one that admits it (no-silent-caps).
 */
export interface ProviderInvoicePage {
  invoices: ProviderInvoice[];
  truncated: boolean;
  /**
   * Rows the provider returned that were dropped as unrenderable
   * (missing date/amount/currency — never-fabricate). Carried so the
   * caller can distinguish "never billed" from "billed, but nothing was
   * renderable": with wrong field names every row drops, and without
   * this count that reads as an empty history (gate network 2026-08-16,
   * CONFIRMED).
   */
  omitted: number;
}

/** One provider billing document, normalized (see `listInvoices`). */
export interface ProviderInvoice {
  /** Provider-side id — the handle `invoiceDocumentUrl` takes. */
  id: string;
  issuedAt: string;
  /** Lowest currency unit, as a string (provider-money convention). */
  amount: string;
  currencyCode: string;
  status: 'paid' | 'due' | 'canceled' | 'unknown';
  /** Confirmed aggregate refunds; original payment amount and document remain intact. */
  refundedAmount?: string;
  /** A stable provider-hosted page, when the rail exposes one. */
  hostedUrl: string | null;
  /** Whether `invoiceDocumentUrl` can mint a document for this row. */
  documentAvailable: boolean;
}

/** Sanitized exact-transaction evidence for a durable purchase. */
export type CheckoutTransactionFacts = {
  state: 'unpaid' | 'in_flight' | 'paid' | 'completed' | 'stopped';
  transactionId: string;
  subscriptionId: string | null;
  customerId: string | null;
};
export interface CheckoutTransactionOwner {
  id: string;
  workspaceId: string;
  providerPriceId: string;
  currencyCode: string;
  offer: string | null;
}
