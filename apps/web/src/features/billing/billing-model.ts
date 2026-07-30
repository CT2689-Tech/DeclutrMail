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
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
 * The billing read answered 200 with a payload the contract schema
 * cannot narrow. Thrown by the read hook's Zod parse; the derive layer
 * maps it to the `unknown` view state — the screen renders honest
 * ignorance instead of `TIER_MANIFEST[garbage]` or an invented price.
 */
export class BillingPayloadError extends Error {
  constructor() {
    super('GET /api/billing/subscription returned a payload outside BillingSubscriptionSchema');
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

export type NonBackingReason = 'paused' | 'canceled' | 'tier_mismatch';

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
 */
export function nonBackingBlocksNewCheckout(record: NonBackingRecord | null): boolean {
  return record !== null && record.sub.status !== 'canceled';
}

function nonBackingReason(sub: SubscriptionRecord, entitlementTier: TierId): NonBackingReason {
  if (sub.status === 'canceled') return 'canceled';
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
  return 'Included with your account';
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
    const end = formatBillingDate(backing.sub.currentPeriodEnd);
    return {
      tone: 'warn',
      text: end
        ? `Cancellation scheduled — your plan stays active until ${end}, then you'll switch to Free.`
        : "Cancellation scheduled — you'll switch to Free at the end of the current period.",
    };
  }
  if (backing.state === 'past_due') {
    return {
      tone: 'warn',
      text: 'Payment past due — update your payment method with the provider to keep your plan.',
    };
  }
  return null;
}
