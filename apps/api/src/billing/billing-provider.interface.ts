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
}

/**
 * Scratch space shared by every `providerCancellationFacts` call in ONE
 * reconciliation pass, created and dropped by the caller.
 *
 * Exists because some provider reads are account-wide rather than
 * subscription-scoped, so asking them once per row asks the identical
 * question N times. Razorpay's `/v1/disputes` is the case: it documents
 * no payment or subscription filter, so the adapter pages the whole
 * account list and filters client-side. Verified 2026-08-14 against
 * Razorpay's Fetch All Disputes reference — `expand` is the only
 * documented query parameter — so this is the API's shape, not a missing
 * optimisation in the adapter.
 *
 * The LIFETIME is the point, and it is enforced by scope rather than by
 * a clock. The caller allocates one before its loop and lets it fall out
 * of reach after; nothing can read a value from a previous pass because
 * no reference to it survives. A TTL would have given the same dedup
 * with a staleness window and a time-dependent test, on a code path
 * whose entire value is being deterministic about provider truth.
 *
 * OPTIONAL on the interface, so a provider whose reads are already
 * scoped implements nothing: TypeScript accepts a narrower
 * `(id: string)` method here, which is why Paddle needs no no-op path.
 * Passing no cache is always correct and always fresh — that is the
 * shape webhook-time callers get.
 *
 * RULE FOR ANY ADAPTER THAT USES THIS. A snapshot is taken when the
 * pass's first row runs, so it cannot see anything that happened during
 * the pass. That is fine for every answer EXCEPT one: an adapter must
 * never report `settled: 'refund'` off a cached read alone. That answer
 * lets the caller free the workspace's plan slot, the settlement is
 * terminal, and the watch pass deliberately never resurrects the row —
 * so a stale "no chargeback" re-arms a disputing customer permanently,
 * with only an operator able to undo it. Re-read fresh before giving it
 * (`RazorpayAdapter.providerCancellationFacts` is the worked example).
 * The cost lands only on rows that are actually settling.
 */
export class CancellationFactsCache {
  private readonly reads = new Map<string, Promise<unknown>>();

  /**
   * Run `read` once per `key` for this pass, handing every later caller
   * the first call's promise.
   *
   * Memoizes the PROMISE, not the resolved value, so callers that
   * overlap share one in-flight request rather than racing to start a
   * second.
   *
   * A failed read is memoized too, deliberately. `listCollection`
   * answers `null` for "could not read in full", and its two causes both
   * argue for holding it: a listing past the page bound fails
   * identically every time, which is the 100-rows × 50-pages case this
   * type exists to prevent, and a network fault re-read per row would
   * hammer a provider that is already unwell. Neither loses safety — a
   * null is never grounds for a write, so the pass simply leaves those
   * rows unenforced and the next sweep asks again with a fresh cache.
   */
  once<T>(key: string, read: () => Promise<T>): Promise<T> {
    const inFlight = this.reads.get(key);
    if (inFlight !== undefined) return inFlight as Promise<T>;
    const started = read();
    this.reads.set(key, started);
    return started;
  }
}

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
    cache?: CancellationFactsCache,
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
   * MAY BE ASYNCHRONOUS, and the union is the point: some payloads
   * cannot be normalized without asking the provider a question.
   * Razorpay's refund and dispute entities carry `payment_id` and the
   * payment carries `invoice_id`, but NONE of the three names a
   * subscription — the one documented link is
   * `GET /v1/invoices/{id}` → `subscription_id`, and
   * `cancellation_scheduled` cannot be minted without it.
   *
   * A single `Promise<…>` return would have been simpler to consume but
   * would force EVERY adapter's mapper to be async, erasing the one
   * property worth keeping: Paddle's mapper is pure — its payloads carry
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

  /**
   * D119 / ADR-0035 — a self-serve payment-method surface, when the rail
   * has one.
   *
   * Returns a CAPABILITY, never a nullable URL: Razorpay subscriptions
   * cannot change instrument without re-authorizing the mandate, and
   * `null` would make "this rail can't" indistinguishable from "the
   * read failed". The FE renders the `unsupported` arm as
   * support-assisted copy, exactly as it already does for Razorpay
   * pause and resume.
   *
   * The URL is short-lived and customer-specific — minted per call,
   * never cached or persisted. Throws `BILLING_PROVIDER_ERROR` on
   * network/5xx.
   */
  paymentMethodSession(input: PaymentMethodSessionInput): Promise<PaymentMethodSessionResult>;

  /**
   * D119 / ADR-0035 — the subscription's billing documents, newest
   * first, proxied on read and never persisted.
   *
   * Amounts come back in the currency's LOWEST unit (the existing
   * provider-money convention). A status this adapter cannot map stays
   * `'unknown'` rather than being rounded to `paid` — both providers'
   * status vocabularies are wider than the normalized enum, and
   * guessing would assert something the read did not say.
   *
   * Throws `BILLING_PROVIDER_ERROR` on network/5xx: the caller reports
   * the rail as unavailable rather than serving a silently short list.
   */
  listInvoices(providerSubscriptionId: string): Promise<ProviderInvoicePage>;

  /**
   * D119 / ADR-0035 — mint a document URL for one invoice, per click.
   *
   * `null` here means this rail mints nothing because it does not need
   * to: Razorpay exposes a stable hosted invoice page on the row itself
   * (`hostedUrl`), so there is no per-click artifact to create. That is
   * a capability fact the row already carries via `documentAvailable`,
   * not an error — unlike `paymentMethodSession`, the FE never has to
   * distinguish a null here from a failure, because it only calls this
   * for rows that advertised `documentAvailable: true`.
   */
  invoiceDocumentUrl(invoiceId: string): Promise<string | null>;
}

/**
 * Input to `paymentMethodSession`. Both ids are passed because the two
 * rails key the surface differently — Paddle's portal session is
 * CUSTOMER-scoped (and takes the subscription only to deep-link the
 * right row), while a future subscription-scoped rail would need the
 * subscription id. Neither adapter may infer one from the other.
 */
export interface PaymentMethodSessionInput {
  providerCustomerId: string;
  providerSubscriptionId: string;
}

export type PaymentMethodSessionResult =
  { kind: 'url'; url: string } | { kind: 'unsupported'; reason: 'no_self_serve' };

/**
 * One page of billing documents.
 *
 * `truncated` exists so a capped read cannot pass for a complete
 * history. Both adapters ask for a single large page; when the provider
 * reports more rows behind it, that fact reaches the UI rather than
 * being dropped — a list that silently omits older invoices is worse
 * than one that admits it (no-silent-caps).
 */
export interface ProviderInvoicePage {
  invoices: ProviderInvoice[];
  truncated: boolean;
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
  /** A stable provider-hosted page, when the rail exposes one. */
  hostedUrl: string | null;
  /** Whether `invoiceDocumentUrl` can mint a document for this row. */
  documentAvailable: boolean;
}
