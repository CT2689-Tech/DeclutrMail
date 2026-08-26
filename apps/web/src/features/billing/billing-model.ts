/**
 * Billing-screen view model (D119/D120/D121).
 *
 * PURE derivations over `TIER_MANIFEST` + the `BillingSubscription`
 * payload — no dollar amount or limit is hardcoded here (same
 * discipline as the /pricing model, which this reuses).
 */

import { TIER_MANIFEST, TIER_RANK, type TierId } from '@declutrmail/shared/entitlements';
import type { BillingCycle, BillingSubscription } from '@declutrmail/shared/contracts';

import {
  currencyForPricePoint,
  currencyForProvider,
  formatMoney,
  formatUsd,
  type Currency,
} from '@/features/marketing/pricing/pricing-model';
import { apiErrorCode } from '@/lib/api/client';
import type { BillingProviderId } from '@declutrmail/shared/contracts';

import type { PendingCheckout } from './pending-checkout';

/** The condensed-strip tiers (D119) — the three self-serve rungs. */
export const STRIP_TIER_IDS = ['free', 'plus', 'pro'] as const;
export type StripTierId = (typeof STRIP_TIER_IDS)[number];

function priceLabel(tier: TierId, cycle: BillingCycle, currency: Currency): string | null {
  const point = TIER_MANIFEST[tier].prices[cycle === 'annual' ? 'annual' : 'monthly'];
  if (!point) return null;
  return `${formatMoney(point, currency)}${cycle === 'annual' ? '/yr' : '/mo'}`;
}

/**
 * "$19/mo" — the price of a plan someone MIGHT buy, on the rail they
 * would be routed to.
 *
 * CLAMPED to what that rail can actually charge: preferring Razorpay
 * does not make a plan purchasable on it (India is deferred, every
 * `razorpayPlanId` is null), and checkout falls back to Paddle/USD. A
 * quote naming a currency the checkout cannot take is a promise we
 * break one click later.
 *
 * For a subscription that ALREADY EXISTS use `chargedPlanPrice` — these
 * answer different questions and must not be merged back together.
 */
export function quotedPlanPrice(
  tier: TierId,
  cycle: BillingCycle,
  provider: BillingProviderId = 'paddle',
): string | null {
  const point = TIER_MANIFEST[tier].prices[cycle === 'annual' ? 'annual' : 'monthly'];
  if (!point) return null;
  return priceLabel(tier, cycle, currencyForPricePoint(point, provider));
}

/**
 * "₹15,999/yr" — what an EXISTING subscription is actually billed.
 *
 * NOT clamped, deliberately. The subscription's own provider is settled
 * fact: it exists, so it was purchasable on that rail, whatever the
 * catalog says today. Clamping here would show a Razorpay subscriber
 * paying ₹15,999/yr a "$190/yr" headline — the original defect, wearing
 * the fix as a disguise.
 *
 * `founding` selects the PROMO price point (D126). A Founding Pro
 * member is billed $129/yr, not the standard $190/yr, for as long as
 * the subscription stays active — reading the standard point off the
 * tier states a charge that never happens, and contradicts the founding
 * banner sitting on the same screen.
 */
export function chargedPlanPrice(
  tier: TierId,
  cycle: BillingCycle,
  provider: BillingProviderId,
  founding = false,
): string | null {
  const currency = currencyForProvider(provider);
  const promo = TIER_MANIFEST[tier].promo;
  // The promo is an annual-only price point; a founding member on any
  // other cycle is billed the standard line.
  if (founding && promo && cycle === 'annual') {
    return `${formatMoney(promo.annual, currency)}/yr`;
  }
  return priceLabel(tier, cycle, currency);
}

/**
 * Whole months of the monthly price the annual cycle saves ("2 months
 * free"), derived from the manifest — never a hardcoded claim. Null
 * when a cycle is missing, the tier is free, or the saving isn't an
 * exact whole number of months (an approximate claim would be a lie).
 */
export function annualMonthsFree(tier: TierId): number | null {
  const { monthly, annual } = TIER_MANIFEST[tier].prices;
  if (!monthly || !annual || monthly.usdCents <= 0) return null;
  const savedCents = monthly.usdCents * 12 - annual.usdCents;
  if (savedCents <= 0 || savedCents % monthly.usdCents !== 0) return null;
  return savedCents / monthly.usdCents;
}

/**
 * The annual saving shared by EVERY purchasable paid tier, or null when
 * the tiers disagree — a single toggle badge must not promise a saving
 * some plan doesn't deliver.
 */
export function sharedAnnualMonthsFree(): number | null {
  const values = STRIP_TIER_IDS.filter((id) => id !== 'free').map((id) => annualMonthsFree(id));
  const [first] = values;
  if (first == null || values.some((v) => v !== first)) return null;
  return first;
}

/**
 * D120 — is this paid→paid change a deferred (period-end) downgrade?
 * MUST mirror `isDowngrade` in apps/api billing.service.changePlan —
 * the preview's "$0 today vs charged now" claim rides on agreement.
 */
export function isDeferredDowngrade(
  fromTier: TierId,
  fromCycle: BillingCycle,
  toTier: TierId,
  toCycle: BillingCycle,
): boolean {
  return (
    (fromTier === 'pro' && toTier === 'plus') ||
    (fromTier === toTier && fromCycle === 'annual' && toCycle === 'monthly')
  );
}

/** "Jun 1, 2026" — en-US to match the D119 mock. Null-safe. */
export function formatBillingDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Provider money → display string. Providers quote in the currency's
 * LOWEST unit ("1900" = $19.00, JPY has no minor unit), so the divisor
 * comes from the currency's own exponent via Intl, never a hard-coded
 * 100. Null on anything unparsable — callers fall back to generic copy
 * rather than showing an invented number (never-fabricate rule).
 */
export function formatProviderAmount(amount: string, currencyCode: string): string | null {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  try {
    const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode });
    const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
    return fmt.format(n / 10 ** digits);
  } catch {
    return null;
  }
}

/**
 * D121 — the money-back guarantee line. Applies to EVERY paid plan
 * (founder-confirmed 2026-07-08; the published /refunds policy and the
 * cancel flow both surface it for Plus and Pro alike).
 */
export const MONEY_BACK_NOTE = '30-day money-back guarantee';

// ── D119/A6 — the single derived billing story ───────────────────────
//
// The billing screen used to let each surface read the raw subscription
// row for itself, so an entitlement/row disagreement ("tier: pro" +
// paused Plus row) rendered TWO plans at once. `deriveBillingViewState`
// is the one place the read is interpreted; every component renders
// from the resulting discriminated union and never from the raw row.
// See docs/adr/0027-billing-presentation-state.md.

/** The provider subscription record as served by the billing read. */
export type SubscriptionRecord = NonNullable<BillingSubscription['subscription']>;

/**
 * Poll cadence while a refund settles.
 *
 * The settling notice tells the customer the screen will switch itself
 * back on, and without a poll that is false: `refetchOnWindowFocus` is
 * off globally (`lib/query-client.ts`) and this query's
 * `refetchInterval` defaults to false, so an open tab would sit on the
 * settling state until a hard reload — including long after the refund
 * settled and the plan became purchasable again. Promising automatic
 * recovery while providing none is the assert-what-you-don't-know defect
 * aimed at the one screen that had just been fixed for it (Codex
 * stop-review, 2026-08-14).
 *
 * A minute, not seconds: the wait is a provider review queue measured in
 * hours, so this exists to catch the transition eventually rather than
 * promptly. `refetchIntervalInBackground` is deliberately left at its
 * default (false) — the interval then runs only while the tab is
 * focused, which is exactly when the promise is observable, and a
 * day-long wait costs nothing while nobody is looking.
 */
export const REFUND_SETTLING_POLL_MS = 60_000;

/**
 * Is a refund in flight on this payload's subscription?
 *
 * Gates the poll above. Deliberately BROADER than the `refund_settling`
 * notice, which additionally requires the row to be non-backing: if a
 * refund lands while the entitlement it funded still matches, we would
 * rather poll and find out than pin a stale screen on a technicality.
 * Every state this admits resolves by re-reading.
 */
export function isRefundSettling(data: BillingSubscription | undefined): boolean {
  const sub = data?.subscription;
  return sub != null && sub.status !== 'canceled' && sub.cancelSource === 'refund';
}

/**
 * The billing read answered 200 with a payload the contract schema
 * cannot narrow. Thrown by the read hook's Zod parse; the derive layer
 * maps it to the `unknown` view state — the screen renders honest
 * ignorance instead of `TIER_MANIFEST[garbage]` or an invented price.
 */
export class BillingPayloadError extends Error {
  constructor(endpoint = 'GET /api/billing/subscription') {
    // The endpoint is part of the message so a Sentry line names WHICH
    // read broke its contract — three more billing endpoints now throw
    // this class, and an argument-less error attributed them all to the
    // subscription read (gate network 2026-08-16).
    super(`${endpoint} returned a payload outside its contract schema`);
    this.name = 'BillingPayloadError';
  }
}

/**
 * The record that GRANTS the entitlement tier: same tier AND a
 * granting status (the server's GRANTING_STATUSES: active/past_due).
 * `cancel_scheduled` is a granting record with `cancelAtPeriodEnd` —
 * still charging, still granting, renewal withdrawn. Everything else
 * is a non-backing record and never a source for the current plan's
 * name, price, renewal, or provider.
 */
export type BackingState =
  | { state: 'none' }
  | { state: 'active' | 'past_due' | 'cancel_scheduled'; sub: SubscriptionRecord };

export type NonBackingReason = 'paused' | 'canceled' | 'tier_mismatch' | 'refund_settling';

/**
 * A real, actionable subscription record that does NOT grant the
 * entitlement tier. `paused`: the ordinary pause story (resume restores
 * or upgrades). `canceled`: the row ended. `tier_mismatch`: the
 * entitlement OUTRANKS what this row grants (or a granting-status row
 * names a different tier) — the workspace's plan comes from elsewhere,
 * and resume/cancel verbs carry cross-tier consequences.
 */
export interface NonBackingRecord {
  reason: NonBackingReason;
  sub: SubscriptionRecord;
}

export interface BillingPlanView {
  /** The workspace's resolved tier — the ONLY "current plan" any surface may name. */
  entitlementTier: TierId;
  backing: BackingState;
  nonBacking: NonBackingRecord | null;
  /** Only ever read off a BACKING record — a non-backing row's marker is not a plan fact. */
  scheduledChange: SubscriptionRecord['scheduledChange'];
  foundingMember: boolean;
  /**
   * A live complimentary grant, or null. The GRANT, not the resolved
   * tier: a comped Plus who bought Pro reads `plus` here, so the card
   * can say what the comp covers without claiming the whole plan.
   */
  complimentary: BillingSubscription['complimentary'];
}

export type BillingViewState =
  | { kind: 'loading' }
  | { kind: 'billing_dark'; entitlementTier: TierId }
  | { kind: 'read_failed'; error: unknown }
  | ({ kind: 'payment_pending'; pending: PendingCheckout } & BillingPlanView)
  | ({ kind: 'plan' } & BillingPlanView)
  | { kind: 'unknown' };

/** The plan payload when no billing read body exists (billing dark, or
 *  a pending lock on a mount whose read has no data yet): entitlement
 *  from `me`, no subscription claims of any kind. */
export function emptyPlanView(entitlementTier: TierId): BillingPlanView {
  return {
    entitlementTier,
    backing: { state: 'none' },
    nonBacking: null,
    scheduledChange: null,
    foundingMember: false,
    // No read body means no knowledge of a grant. Null is "we do not
    // know", not "there is none" — the card renders no comp claim
    // either way, which is the honest reading of both.
    complimentary: null,
  };
}

/**
 * True when a NON-BACKING record still occupies the workspace's ONE
 * live-subscription slot server-side: `createCheckout` answers 409
 * SUBSCRIPTION_EXISTS for any row in status active/past_due/paused
 * (billing.service.ts) — the row failing the BACKING test does not
 * free that slot. Offering a new checkout past this predicate is a
 * guaranteed dead-end 409, so the picker must stay locked until the
 * row is resumed into backing or canceled. Only a canceled row leaves
 * the slot free. Mirrors the SERVER's status set — not the reason.
 *
 * `refund_settling` blocks too, and must. The server refuses that row's
 * checkout with `SUBSCRIPTION_REFUND_SETTLING` until the provider
 * confirms the refund, so offering the CTA would still be a guaranteed
 * 409. What that reason changes is the NOTICE, which now says why and
 * that it clears itself — the picker staying locked is correct, a locked
 * picker with no explanation was not.
 */
export function nonBackingBlocksNewCheckout(record: NonBackingRecord | null): boolean {
  return record !== null && record.sub.status !== 'canceled';
}

function nonBackingReason(sub: SubscriptionRecord, entitlementTier: TierId): NonBackingReason {
  if (sub.status === 'canceled') return 'canceled';
  // A live row under a REFUND verdict is the D253 settling window, and it
  // needs its own story because every other reason here misreads it.
  //
  // The row is `active` while `entitlement_ends_at` has already lapsed, so
  // the generic `tier_mismatch` copy fires — "this subscription isn't what
  // grants it. Cancel it if you're done with it." Both halves mislead: the
  // cause is a refund in flight, not a stray subscription, and cancel does
  // nothing (the projector already pinned `cancel_at_period_end`, and the
  // service's cancel is idempotent, so the click skips the provider
  // entirely). Meanwhile the picker is locked, so the screen offered no
  // explanation and one inert button — observed on the first live refund,
  // 2026-08-14.
  //
  // CHARGEBACK is deliberately NOT here. A settled refund frees the plan
  // slot; a settled chargeback never does (founder decision, 2026-08-13),
  // so "you'll be able to subscribe again once this is confirmed" would be
  // false for it. It keeps the existing story until its period ends.
  //
  // Since 2026-08-25 this is the BACKSTOP, not the default. A pending
  // refund now keeps its entitlement, so the row stays BACKING and tells
  // its story through `backingStatusNote` instead. Reaching here means
  // the grace deadline elapsed with no settlement and no rejection —
  // i.e. we have been unable to read the provider for a week, which now
  // alerts. The copy below is still exactly right for that case, and it
  // is the one case where a locked picker is genuinely unavoidable.
  if (sub.cancelSource === 'refund') return 'refund_settling';
  if (sub.status === 'paused') {
    // A paused row under an entitlement that OUTRANKS it is the A6
    // repro shape: the plan is granted from elsewhere, and resuming
    // re-grants the SUB's tier — the webhook recompute
    // (billing-webhook.service recomputeWorkspaceTier) rebuilds the
    // workspace tier from subscription rows, which can downgrade it.
    return TIER_RANK[entitlementTier] > TIER_RANK[sub.tier] ? 'tier_mismatch' : 'paused';
  }
  // Granting status but a different tier than the entitlement — the
  // backing test already failed, so the row cannot tell the plan story.
  return 'tier_mismatch';
}

function planViewOf(payload: BillingSubscription): BillingPlanView {
  const entitlementTier: TierId = payload.tier;
  const sub = payload.subscription;
  let backing: BackingState = { state: 'none' };
  let nonBacking: NonBackingRecord | null = null;
  if (sub !== null) {
    if ((sub.status === 'active' || sub.status === 'past_due') && sub.tier === entitlementTier) {
      backing = { state: sub.cancelAtPeriodEnd ? 'cancel_scheduled' : sub.status, sub };
    } else {
      nonBacking = { reason: nonBackingReason(sub, entitlementTier), sub };
    }
  }
  return {
    entitlementTier,
    backing,
    nonBacking,
    scheduledChange: backing.state === 'none' ? null : backing.sub.scheduledChange,
    foundingMember: payload.foundingMember,
    complimentary: payload.complimentary,
  };
}

export interface BillingReadSnapshot {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  /** The Zod-parsed read body (the hook throws `BillingPayloadError` before an unparsed one gets here). */
  data: BillingSubscription | undefined;
  /** Entitlement fallback from `/api/auth/me` for states with no read body. */
  meTier: TierId;
  pending: PendingCheckout | null;
}

/**
 * The one interpretation of the billing read (A6). Precedence:
 * a pending money action outranks everything but loading (its lock and
 * poll must stay visible through transient read failures — the error
 * state's "no charge was made" would be false); `billing_dark` is the
 * D202 `BILLING_DISABLED` CODE, never "any 503" (MISTAKES 2026-07-26:
 * a status says how a request failed, never why).
 */
export function deriveBillingViewState(read: BillingReadSnapshot): BillingViewState {
  if (read.isLoading) return { kind: 'loading' };
  if (read.pending !== null) {
    return {
      kind: 'payment_pending',
      pending: read.pending,
      ...(read.data !== undefined ? planViewOf(read.data) : emptyPlanView(read.meTier)),
    };
  }
  if (apiErrorCode(read.error) === 'BILLING_DISABLED') {
    return { kind: 'billing_dark', entitlementTier: read.meTier };
  }
  if (read.error instanceof BillingPayloadError) return { kind: 'unknown' };
  if (read.isError) return { kind: 'read_failed', error: read.error };
  if (read.data === undefined) return { kind: 'unknown' };
  return { kind: 'plan', ...planViewOf(read.data) };
}

/**
 * The current-plan card's headline price — provider price ONLY from the
 * backing record. Backing `none` on a paid tier makes NO price claim
 * (nobody is charged one); the old quotedPlanPrice headline printed a
 * price for a plan nobody was paying for (A6).
 */
export function currentPlanPriceLabel(view: BillingPlanView): string {
  if (view.backing.state !== 'none') {
    const { sub } = view.backing;
    return chargedPlanPrice(sub.tier, sub.cycle, sub.provider, sub.foundingMember) ?? '';
  }
  if (view.entitlementTier === 'free') return formatUsd(0);
  // A comp is the reason there is no price, so say so instead of the
  // generic line. Only when the grant reaches the tier being named: a
  // comped Plus sitting on a paid-but-non-backing Pro row is not a
  // complimentary Pro, and this headline must not imply the whole plan
  // is free of charge.
  if (view.complimentary !== null && TIER_RANK[view.complimentary.tier] >= tierRank(view)) {
    return 'Complimentary';
  }
  return 'Included with your account';
}

function tierRank(view: BillingPlanView): number {
  return TIER_RANK[view.entitlementTier];
}

/**
 * The plan card's complimentary line — who granted this and until when.
 *
 * States the EXPIRY and what follows it, because the alternative is the
 * screen letting a dated comp lapse silently: the tier drops on the next
 * recompute and nothing on the plan card had ever mentioned a date.
 * Permanent comps make no end-date claim at all.
 */
export function complimentaryNote(view: BillingPlanView): string | null {
  const comp = view.complimentary;
  if (comp === null) return null;
  // A grant the workspace has not actually been raised to yet is NOT in
  // force, and saying so contradicts the tier printed directly above it.
  // The window is real: a grant written straight to the table (rather
  // than through `pnpm grant-tier`, which recomputes) is only applied by
  // the 6-hourly sweep, and until then the card would read "Free" over
  // "Pro is complimentary on this account". Claim nothing until the
  // entitlement agrees. A comp BELOW the resolved tier still renders —
  // that is a comped Plus who also pays for Pro, and both are true.
  if (TIER_RANK[comp.tier] > TIER_RANK[view.entitlementTier]) return null;
  const name = TIER_MANIFEST[comp.tier].name;
  const until = formatBillingDate(comp.expiresAt);
  if (until === null) {
    return `${name} is complimentary on this account, granted by DeclutrMail. There's nothing to pay for it.`;
  }
  return `${name} is complimentary on this account through ${until}, granted by DeclutrMail. After that your plan reverts to your paid subscription, or to ${TIER_MANIFEST.free.name} if you have none.`;
}

/**
 * One-line status descriptor for the plan card — BACKING states only.
 * The old `statusNote` also carried paused/canceled branches; those
 * rows are non-backing and render through the non-backing notice now.
 */
export function backingStatusNote(
  backing: BackingState,
): { tone: 'warn' | 'muted'; text: string } | null {
  if (backing.state === 'cancel_scheduled') {
    // Neither verdict may claim `currentPeriodEnd`: it is still a future
    // date that no longer describes when this plan ends, so the "stays
    // active until <date>" line below would be a confident lie for both.
    // Claim no date, and name the cause — "Cancellation scheduled" reads
    // as something the user did. The "Keep my subscription" affordance is
    // refused for these rows either way.
    //
    // The two verdicts now differ in TENSE, and that is the point.
    //
    // A REFUND is pending, not finished. Since 2026-08-25 the plan runs
    // until the provider confirms the refund, so past tense here would
    // tell a customer their plan had ended while they were still using
    // it. There is no date to give: approval is a provider review queue
    // we cannot see — the first live one took 10.5 hours, and the next
    // is not promised to. So the note says what is true (you still have
    // this) and what happens next (it ends when the money goes back),
    // and promises no clock.
    //
    // A CHARGEBACK still ends entitlement immediately (founder decision
    // 2026-07-20), so its copy stays in the past tense.
    if (backing.sub.cancelSource === 'refund') {
      return {
        tone: 'warn',
        // "…or your current period ends" is not padding. The deadline is
        // `LEAST(now() + 7d, current_period_end)`, so a refund with fewer
        // than seven days of period left switches the customer to Free
        // with no confirmation ever arriving. An earlier draft of this
        // line promised the plan "until your payment provider confirms
        // it" full stop, which is precisely the assert-what-you-don't-know
        // shape this screen exists to avoid — caught by the design gate,
        // not by a test.
        text: 'Your refund is being processed — you keep this plan until your payment provider confirms it or your current period ends, whichever comes first. Nothing to do until then.',
      };
    }
    if (backing.sub.cancelSource === 'chargeback') {
      return {
        tone: 'warn',
        text: 'This plan ended after a chargeback. Email support@declutrmail.com if that looks wrong.',
      };
    }
    const end = formatBillingDate(backing.sub.currentPeriodEnd);
    return {
      tone: 'warn',
      text: end
        ? `Cancellation scheduled — your plan stays active until ${end}, then you'll switch to Free.`
        : "Cancellation scheduled — you'll switch to Free at the end of the current period.",
    };
  }
  if (backing.state === 'past_due') {
    // Names the affordance that is now ON THIS SCREEN. The previous
    // wording — "update your payment method with the provider" — sent
    // the customer to a provider they had no link to, on the one status
    // where not acting ends the plan (ADR-0035).
    //
    // Provider-split because the affordance is: on Razorpay the section
    // below says the card CANNOT be changed self-serve, so "update your
    // payment method below" would point at a refusal (gate network
    // 2026-08-16). The note promises only what its rail can deliver.
    return {
      tone: 'warn',
      text:
        backing.sub.provider === 'razorpay'
          ? 'Payment past due — see the payment-method section below; we’ll help you fix this.'
          : 'Payment past due — update your payment method below to keep your plan.',
    };
  }
  return null;
}
