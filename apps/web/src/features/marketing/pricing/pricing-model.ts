/**
 * Shared pricing helpers (D17 pricing leg; ladder per D19/D77/D81):
 * money formatting, the charged currency, and per-tier copy. Amounts
 * come from the entitlements pricing config; nothing here hardcodes a
 * price.
 *
 * Verb language (D227): the only user-facing action verbs on this
 * surface are Keep · Archive · Unsubscribe · Later · Delete. "Screener"
 * is the allowed FEATURE name; the internal "screen" verdict never
 * appears.
 */

import { RAILS, TIER_IDS, type Capability, type TierId } from '@declutrmail/shared/entitlements';

/** Manifest order IS display order (free → enterprise, per D19). */
export const PRICING_TIER_ORDER: readonly TierId[] = TIER_IDS;

/** $0 / $9 / $7.50 — whole dollars unless the amount has real cents. */
export function formatUsd(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/**
 * ₹749 / ₹10,999 — Indian digit grouping (`en-IN` groups by lakh, so
 * ₹1,09,999 not ₹109,999 once amounts pass 1,00,000).
 */
function groupIndianDigits(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`;
}

export function formatInr(paise: number): string {
  const rupees = paise / 100;
  if (!Number.isFinite(rupees)) return '₹NaN';
  const negative = rupees < 0;
  const abs = Math.abs(rupees);
  const [whole, frac] = (Number.isInteger(abs) ? String(abs) : abs.toFixed(2)).split('.');
  const body = frac
    ? `${groupIndianDigits(whole ?? '0')}.${frac}`
    : groupIndianDigits(whole ?? '0');
  return `${negative ? '-' : ''}₹${body}`;
}

/**
 * The currency a price is actually CHARGED in (D117).
 *
 * Not a display preference — it is a fact about the provider: Paddle
 * settles USD as merchant-of-record for the rest of the world, Razorpay
 * settles INR for India. Rendering one while charging the other is the
 * defect this type exists to make unrepresentable, so every price
 * surface takes a Currency rather than assuming USD.
 */
export type Currency = 'USD' | 'INR';

/** Which currency a provider settles in. */
export function currencyForProvider(provider: 'paddle' | 'razorpay'): Currency {
  return provider === 'razorpay' ? 'INR' : 'USD';
}

/**
 * The currency a SPECIFIC price point would actually be charged in on a
 * given rail.
 *
 * Region preference alone is not enough to quote INR, because provisioning
 * is per PRICE POINT, not per provider. Razorpay went live for India on
 * 2026-07-25 and every paid point currently carries a `razorpayPlanId`
 * (Free is null — it is $0 and never reaches checkout), but that is a fact
 * about today's catalog, not an invariant: a new tier or promo can ship on
 * Paddle first, and a point whose Razorpay id is missing must clamp back to
 * USD rather than quote a price no checkout will honour.
 *
 * Quoting ₹1,599 to an India visitor whose checkout charges $19 is the same
 * defect as the reverse, and region-only resolution makes it easy to
 * reintroduce. Taking the POINT — not just the provider — makes an
 * unpurchasable currency unrepresentable: INR requires that this exact
 * point is purchasable on Razorpay.
 */
export function currencyForPricePoint(
  point: {
    razorpayPlanId: string | null;
    inrPaise?: number;
    inr?: { paise: number };
    usdCents?: number;
  },
  provider: 'paddle' | 'razorpay',
  geo?: { country?: string | null; indiaCheckoutOpen?: boolean },
): Currency {
  if (geo !== undefined && !RAILS.razorpay.enabled) {
    if (geo.country?.toUpperCase() !== 'IN' || geo.indiaCheckoutOpen !== true) return 'USD';
    const paise = point.inr?.paise ?? point.inrPaise ?? 0;
    const usd = point.usdCents ?? 0;
    // Free is 0/0 — follow the visitor locale. A paid USD-only point
    // (usd > 0, no INR amount) stays USD so we never quote ₹0 for a charge.
    return paise > 0 || usd === 0 ? 'INR' : 'USD';
  }
  return provider === 'razorpay' && point.razorpayPlanId !== null ? 'INR' : 'USD';
}

/**
 * Format a manifest price point in a currency. The manifest carries
 * BOTH amounts per point (`usdCents` / `inrPaise`) as independently
 * chosen prices — never a runtime FX conversion — so this only picks
 * the right field.
 */
export function formatMoney(
  point: { usdCents: number; inrPaise: number },
  currency: Currency,
): string {
  return currency === 'INR' ? formatInr(point.inrPaise) : formatUsd(point.usdCents);
}

/**
 * One-sentence tier jobs (D19's "Job" column). Copy, not entitlement
 * data — the only per-tier strings that legitimately live outside the
 * manifest.
 */
export const TIER_JOBS: Readonly<Record<TierId, string>> = {
  free: 'Review and clean up senders in one Gmail inbox.',
  plus: 'Clear a larger backlog and set rules for future mail.',
  // QA-billing-20260901-10: "every account" overclaimed against the
  // manifest's actual inboxLimit (5).
  pro: 'Stay on top of your Gmail inboxes with Brief and Follow-ups.',
  team: 'Review and manage email together.',
  enterprise: 'Manage more inboxes with organizational controls.',
};

/**
 * User-facing labels for the manifest capabilities (D227 verb language).
 * Exhaustive over `Capability` — adding a manifest capability without a
 * label is a compile error, so the comparison table can never silently
 * omit a row.
 */
export const CAPABILITY_LABELS: Readonly<Record<Capability, string>> = {
  senders: 'Senders overview',
  'sender-detail': 'Sender detail',
  activity: 'Activity history',
  'cleanup-actions': 'Choices for each sender — Archive · Unsubscribe · Later · Delete',
  triage: 'Triage sessions',
  // ONE feature name, deliberately shared by two capabilities.
  //
  // These were two labels until 2026-08-24. Both capabilities sit on
  // the same tier since the packaging patch, so the table drew two rows
  // ticking identically in every column — which reads as padding, and
  // in a comparison table a row that distinguishes nothing is worse
  // than no row.
  //
  // Sharing the label rather than deleting a capability keeps the
  // internal split intact, so re-tiering stays a manifest edit. The
  // merge is safe only while both are granted identically, and that is
  // not left to memory: `pricing-model.test.ts` fails if two
  // capabilities share a label while any tier grants one without the
  // other, which forces a label decision at the moment they diverge
  // rather than shipping a row that over-promises.
  autopilot: 'Autopilot',
  'autopilot-active': 'Autopilot',
  brief: 'Daily Brief',
  screener: 'Screener — new senders collected for review',
  quiet: 'Quiet hours',
  snoozed: 'Later review queue',
  followups: 'Follow-ups',
};
