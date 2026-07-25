/**
 * Billing-screen view model (D119/D120/D121).
 *
 * PURE derivations over `TIER_MANIFEST` + the `BillingSubscription`
 * payload — no dollar amount or limit is hardcoded here (same
 * discipline as the /pricing model, which this reuses).
 */

import { TIER_MANIFEST, type TierId } from '@declutrmail/shared/entitlements';
import type {
  BillingCycle,
  BillingSubscription,
  SubscriptionStatus,
} from '@declutrmail/shared/contracts';

import {
  currencyForPricePoint,
  currencyForProvider,
  formatMoney,
  type Currency,
} from '@/features/marketing/pricing/pricing-model';
import type { BillingProviderId } from '@declutrmail/shared/contracts';

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
 * D121 — the money-back guarantee line. Applies to EVERY paid plan
 * (founder-confirmed 2026-07-08; the published /refunds policy and the
 * cancel flow both surface it for Plus and Pro alike).
 */
export const MONEY_BACK_NOTE = '30-day money-back guarantee';

/**
 * One-line subscription status descriptor for the plan card. Returns
 * null for plain `active` (the renewal line already says everything).
 */
export function statusNote(
  sub: NonNullable<BillingSubscription['subscription']>,
): { tone: 'warn' | 'muted'; text: string } | null {
  if (sub.cancelAtPeriodEnd) {
    const end = formatBillingDate(sub.currentPeriodEnd);
    return {
      tone: 'warn',
      text: end
        ? `Cancellation scheduled — your plan stays active until ${end}, then you'll switch to Free.`
        : "Cancellation scheduled — you'll switch to Free at the end of the current period.",
    };
  }
  if (sub.status === 'past_due') {
    return {
      tone: 'warn',
      text: 'Payment past due — update your payment method with the provider to keep your plan.',
    };
  }
  if (sub.status === 'paused') {
    const until = formatBillingDate(sub.pauseUntil);
    return {
      tone: 'muted',
      text: until ? `Subscription paused until ${until}.` : 'Subscription paused.',
    };
  }
  if (sub.status === 'canceled') {
    return { tone: 'muted', text: 'Subscription ended — your workspace is on the Free plan.' };
  }
  return null;
}

/** Whether the plan card offers the cancel affordance (D118). */
export function canCancel(sub: BillingSubscription['subscription']): boolean {
  if (!sub) return false;
  const cancellable: SubscriptionStatus[] = ['active', 'past_due', 'paused'];
  return cancellable.includes(sub.status) && !sub.cancelAtPeriodEnd;
}
