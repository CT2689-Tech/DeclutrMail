/**
 * Billing transport contracts (D117, D118, D126).
 *
 * Zod schemas + types shared between the NestJS billing endpoints
 * (`apps/api/src/billing`) and the FE billing screen hooks. Pure
 * TS/Zod — no React, importable by api + workers.
 *
 * Vocabulary notes:
 *   - `provider` mirrors the `billing_provider` pg_enum (D117: Paddle
 *     merchant-of-record international + Razorpay India; NO Stripe).
 *   - `cycle` mirrors the `billing_cycle` pg_enum.
 *   - `status` mirrors the `subscription_status` pg_enum — NO
 *     `trialing` per D121 (no-trial mechanic, CODEX PATCH on D117).
 *   - Purchasable tiers are `plus` | `pro` only (D19: free needs no
 *     checkout; team/enterprise have no purchase path at launch).
 *   - `foundingPro` is a PROMO price point hosted by `pro`, never a
 *     sixth tier (D126) — see `entitlements/types.ts`.
 *
 * Privacy (D7/D228): billing payloads carry provider ids, tier names,
 * cycle enums, and timestamps only. Never email content.
 */

import { z } from 'zod';

/** D117 — Paddle (international, merchant-of-record) + Razorpay (India). */
export const BillingProviderIdSchema = z.enum(['paddle', 'razorpay']);
export type BillingProviderId = z.infer<typeof BillingProviderIdSchema>;

/** Mirrors the `billing_cycle` pg_enum. */
export const BillingCycleSchema = z.enum(['monthly', 'annual']);
export type BillingCycle = z.infer<typeof BillingCycleSchema>;

/** Mirrors `subscription_status` pg_enum — no `trialing` (D121). */
export const SubscriptionStatusSchema = z.enum(['active', 'past_due', 'canceled', 'paused']);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

/** Self-serve checkout targets at launch (D19). */
export const PurchasableTierSchema = z.enum(['plus', 'pro']);
export type PurchasableTier = z.infer<typeof PurchasableTierSchema>;

/**
 * POST /api/billing/checkout request body.
 *
 * `provider` is the user's EXPLICIT choice (D117: India → Razorpay,
 * everywhere else → Paddle); the API records the implied
 * `users.billing_region` rather than re-deriving it from IP at
 * checkout time.
 *
 * `promo: 'foundingPro'` requires `tierId: 'pro'` + `cycle: 'annual'`
 * (the promo is an annual-only Pro price point, D126) — enforced by
 * the `superRefine` below so a malformed combination fails validation
 * instead of silently checking out at the wrong price.
 */
export const CheckoutRequestSchema = z
  .object({
    tierId: PurchasableTierSchema,
    cycle: BillingCycleSchema,
    provider: BillingProviderIdSchema,
    promo: z.literal('foundingPro').optional(),
  })
  .superRefine((val, ctx) => {
    if (val.promo === 'foundingPro' && (val.tierId !== 'pro' || val.cycle !== 'annual')) {
      ctx.addIssue({
        code: 'custom',
        message: 'foundingPro is an annual-only Pro promo (D126).',
        path: ['promo'],
      });
    }
  });
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;

/**
 * Paddle checkout session — the FE opens the Paddle.js OVERLAY with
 * these values (Paddle Billing has no server-created hosted session
 * for overlay checkouts; the price id + client-side token ARE the
 * session). `clientToken` is Paddle's publishable client-side token
 * (safe to expose to an authed user by design, like a Stripe
 * publishable key). `customData` MUST be passed through to
 * `Paddle.Checkout.open({ customData })` verbatim — the webhook
 * resolves the workspace from it on first contact.
 */
export const PaddleCheckoutSessionSchema = z.object({
  provider: z.literal('paddle'),
  kind: z.literal('overlay'),
  priceId: z.string().min(1),
  clientToken: z.string().min(1),
  environment: z.enum(['sandbox', 'production']),
  // snake_case ON PURPOSE: this object is stored verbatim by Paddle and
  // read back off the webhook as `custom_data.workspace_id`. A camelCase
  // key here makes every first purchase unattributable (the webhook has
  // no subscription or billing_customers row to fall back to yet).
  customData: z.object({
    workspace_id: z.uuid(),
    // Server-issued HMAC over the workspace id. `custom_data` reaches
    // Paddle through the BROWSER, so an unsigned id would let a client
    // attribute a paid subscription onto someone else's workspace; the
    // webhook discards any blob whose signature does not verify.
    sig: z.string().min(1),
  }),
});
export type PaddleCheckoutSession = z.infer<typeof PaddleCheckoutSessionSchema>;

/**
 * Razorpay checkout session — the subscription is created server-side
 * (notes carry the workspace id, so webhook attribution never trusts
 * the client); the FE either opens Razorpay Checkout with
 * `subscriptionId` + `keyId` or falls back to `shortUrl`.
 */
export const RazorpayCheckoutSessionSchema = z.object({
  provider: z.literal('razorpay'),
  kind: z.literal('hosted'),
  subscriptionId: z.string().min(1),
  shortUrl: z.url(),
  keyId: z.string().min(1),
});
export type RazorpayCheckoutSession = z.infer<typeof RazorpayCheckoutSessionSchema>;

/** POST /api/billing/checkout response `data`. */
export const CheckoutSessionSchema = z.discriminatedUnion('provider', [
  PaddleCheckoutSessionSchema,
  RazorpayCheckoutSessionSchema,
]);
export type CheckoutSession = z.infer<typeof CheckoutSessionSchema>;

/**
 * GET /api/billing/subscription response `data`.
 *
 * `tier` is the workspace's CURRENT resolved tier (the entitlement the
 * app gates on), `subscription` the latest provider-side record or
 * null for never-subscribed workspaces. `currentPeriodEnd` is an ISO
 * timestamp or null (providers null the billing period on terminal
 * cancellation).
 */
export const BillingSubscriptionSchema = z.object({
  tier: z.enum(['free', 'plus', 'pro', 'team', 'enterprise']),
  foundingMember: z.boolean(),
  subscription: z
    .object({
      provider: BillingProviderIdSchema,
      tier: PurchasableTierSchema,
      status: SubscriptionStatusSchema,
      cycle: BillingCycleSchema,
      currentPeriodEnd: z.iso.datetime().nullable(),
      cancelAtPeriodEnd: z.boolean(),
      pauseUntil: z.iso.datetime().nullable(),
      foundingMember: z.boolean(),
      scheduledChange: z
        .object({
          tier: PurchasableTierSchema,
          cycle: BillingCycleSchema,
          effectiveAt: z.iso.datetime(),
          state: z.enum(['pending_provider', 'scheduled', 'restoring_current']),
        })
        .nullable(),
    })
    .nullable(),
  /**
   * Cross-device in-flight checkout (0051). Non-null while a checkout
   * this workspace opened has neither granted (webhook clears it) nor
   * expired. The FE locks checkout CTAs on it — the localStorage lock
   * covers only the same browser. Expired/absent = "we no longer claim
   * a checkout is in flight", never "the payment failed".
   */
  pendingCheckout: z
    .object({
      provider: BillingProviderIdSchema,
      tier: PurchasableTierSchema,
      cycle: BillingCycleSchema,
      expiresAt: z.iso.datetime(),
    })
    .nullable(),
});
export type BillingSubscription = z.infer<typeof BillingSubscriptionSchema>;

/**
 * POST /api/billing/cancel request body. D118 — optional reason,
 * cancellation always takes effect at period end (no proration).
 */
export const CancelRequestSchema = z.object({
  reason: z
    .enum(['not_using_enough', 'too_expensive', 'found_another_tool', 'privacy_concerns', 'other'])
    .optional(),
});
export type CancelRequest = z.infer<typeof CancelRequestSchema>;

/**
 * POST /api/billing/change-plan request body (D117/D120 — self-serve
 * paid↔paid switching). The change is applied on the EXISTING provider
 * subscription. Upgrades apply immediately with provider proration.
 * Downgrades are recorded locally for the current period end; no
 * immediate charge, credit, or entitlement loss. No `provider` field:
 * the change rides the subscription's existing provider.
 */
export const PlanChangeRequestSchema = z.object({
  tierId: PurchasableTierSchema,
  cycle: BillingCycleSchema,
});
export type PlanChangeRequest = z.infer<typeof PlanChangeRequestSchema>;

/**
 * POST /api/billing/reconcile response (D249 — provider-truth
 * reconciliation of a pending checkout). The server asks the payment
 * provider what happened to the workspace's open checkout claim so the
 * customer never has to guess:
 *
 *   - `granted` — a matching subscription was found and projected; the
 *     tier flip lands on the next subscription read.
 *   - `already_recorded` — provider truth is unchanged since the last
 *     look (the synthesized event deduped in the ledger).
 *   - `none_found` — the provider answered and holds NO matching
 *     subscription. Legitimizes the manual release affordance.
 *   - `payment_in_progress` — the provider holds a subscription for
 *     this checkout in a PRE-GRANT state (Razorpay created/
 *     authenticated — the 3DS window; unmapped provider statuses).
 *     The release must stay LOCKED: "no payment found" would be false
 *     and a resume here is the double-charge case.
 *   - `no_pending` — no server claim AND no hint to search by. Never a
 *     payment claim in either direction; with the FE always sending
 *     its local record as the hint, a stale >TTL lock reconciles via
 *     provider search instead of landing here.
 *   - `unresolved` — provider truth exists but projection refused it
 *     (live-conflict / unprovisioned price); support territory.
 *   - `provider_unavailable` — could not ask; nothing was asserted and
 *     nothing was written.
 */
export const BillingReconcileOutcomeSchema = z.enum([
  'granted',
  'already_recorded',
  'none_found',
  'payment_in_progress',
  'no_pending',
  'unresolved',
  'provider_unavailable',
]);
export type BillingReconcileOutcome = z.infer<typeof BillingReconcileOutcomeSchema>;

/**
 * POST /api/billing/reconcile request body — the FE's local pending
 * record, sent as a HINT. When the server claim has already expired
 * and been swept (a stale >30-min lock — exactly the lost-webhook
 * case), the hint lets reconciliation still search the provider for a
 * granting subscription matching what the browser was waiting for,
 * instead of answering `no_pending` without asking anyone. Hint fields
 * only FILTER a search over the workspace's own subscriptions; a match
 * still projects through the fully-guarded webhook path.
 */
export const BillingReconcileRequestSchema = z.object({
  toTier: PurchasableTierSchema.optional(),
  cycle: BillingCycleSchema.optional(),
  startedAt: z.iso.datetime().optional(),
  /**
   * What the caller is waiting on. `checkout` (default) runs the
   * pending-checkout ladder above. `change` runs the per-workspace
   * live-subscription check instead: a stuck PLAN CHANGE has no
   * checkout claim by construction (an immediate upgrade writes no
   * server-side marker), and routing it through the checkout ladder
   * would answer `none_found` — "no completed payment found" — about
   * an upgrade that DID charge. Distinct waits, distinct questions.
   *
   * For `change`, `toTier`/`cycle` are the AWAITED target and are
   * load-bearing: after the provider check, "nothing new" splits on
   * them — recorded granting state matches the target →
   * `already_recorded` (a real confirmation); it does not →
   * `none_found` (the provider answered and the awaited change exists
   * nowhere — retry is legitimate). Without them the server cannot
   * tell those opposite truths apart and stays neutral.
   */
  kind: z.enum(['checkout', 'change']).optional(),
});
export type BillingReconcileRequest = z.infer<typeof BillingReconcileRequestSchema>;

export const BillingReconcileResponseSchema = z.object({
  outcome: BillingReconcileOutcomeSchema,
});
export type BillingReconcileResponse = z.infer<typeof BillingReconcileResponseSchema>;

/**
 * POST /api/billing/change-plan/preview — read-only dry run of a plan
 * change (D117/D120) so the confirm panel states the exact charge
 * instead of "a prorated difference".
 *
 *   - `immediate` — an upgrade: `result` is the provider's own
 *     what-happens-now line (amount in the currency's LOWEST unit, so
 *     the FE formats via Intl with the currency's exponent), null when
 *     the provider answered without a parsable summary — the FE falls
 *     back to generic copy, never an invented number. `nextBilledAt`
 *     is the post-change renewal.
 *   - `deferred` — a downgrade: nothing charged now; the change lands
 *     at `effectiveAt` (period end), matching changePlan semantics.
 *   - `none` — same plan or a change already pending: nothing to
 *     preview (the picker disables these paths).
 */
export const PlanChangePreviewRequestSchema = PlanChangeRequestSchema;
export type PlanChangePreviewRequest = z.infer<typeof PlanChangePreviewRequestSchema>;

export const PlanChangePreviewSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('immediate'),
    result: z
      .object({
        action: z.enum(['charge', 'credit']),
        amount: z.string().min(1),
        currencyCode: z.string().min(1),
      })
      .nullable(),
    nextBilledAt: z.iso.datetime().nullable(),
  }),
  z.object({
    kind: z.literal('deferred'),
    effectiveAt: z.iso.datetime().nullable(),
  }),
  z.object({ kind: z.literal('none') }),
]);
export type PlanChangePreview = z.infer<typeof PlanChangePreviewSchema>;
