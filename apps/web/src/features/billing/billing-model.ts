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

import { formatUsd } from '@/features/marketing/pricing/pricing-model';

/** The condensed-strip tiers (D119) — the three self-serve rungs. */
export const STRIP_TIER_IDS = ['free', 'plus', 'pro'] as const;
export type StripTierId = (typeof STRIP_TIER_IDS)[number];

/** "$19/mo" / "$190/yr" off the manifest; null when not offered. */
export function planPriceLabel(tier: TierId, cycle: BillingCycle): string | null {
  const point = TIER_MANIFEST[tier].prices[cycle === 'annual' ? 'annual' : 'monthly'];
  if (!point) return null;
  return `${formatUsd(point.usdCents)}${cycle === 'annual' ? '/yr' : '/mo'}`;
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
