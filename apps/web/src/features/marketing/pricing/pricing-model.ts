/**
 * Pricing-page view model (D17 pricing leg; ladder per D19/D77/D81).
 *
 * PURE derivations over `TIER_MANIFEST` — the single source of truth
 * for every dollar amount, limit, and capability on /pricing. Nothing
 * in this folder hardcodes a price: re-pricing the manifest re-prices
 * the page (and the tests, which assert AGAINST the manifest rather
 * than against literals).
 *
 * Verb language (D227): the only user-facing action verbs on this
 * surface are Keep · Archive · Unsubscribe · Later · Delete. "Screener"
 * is the allowed FEATURE name; the internal "screen" verdict never
 * appears.
 */

import {
  CAPABILITIES,
  TIER_IDS,
  TIER_MANIFEST,
  type Capability,
  type PromoDefinition,
  type TierDefinition,
  type TierId,
} from '@declutrmail/shared/entitlements';

export type BillingInterval = 'monthly' | 'annual';

/** Manifest order IS display order (free → enterprise, per D19). */
export const PRICING_TIER_ORDER: readonly TierId[] = TIER_IDS;

/** All five tier definitions in display order, straight off the manifest. */
export function pricingTiers(): readonly TierDefinition[] {
  return PRICING_TIER_ORDER.map((id) => TIER_MANIFEST[id]);
}

/** Only tiers a visitor can actually choose today. */
export function comparablePricingTiers(): readonly TierDefinition[] {
  return pricingTiers().filter((tier) => tier.purchasable);
}

/** $0 / $9 / $7.50 — whole dollars unless the amount has real cents. */
export function formatUsd(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/**
 * ₹749 / ₹10,999 — Indian digit grouping (`en-IN` groups by lakh, so
 * ₹1,09,999 not ₹109,999 once amounts pass 1,00,000).
 */
export function formatInr(paise: number): string {
  const rupees = paise / 100;
  return `₹${new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rupees)}`;
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

/** Which currency a provider will charge in. */
export function currencyForProvider(provider: 'paddle' | 'razorpay'): Currency {
  return provider === 'razorpay' ? 'INR' : 'USD';
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

/** What a tier card's price slot shows for the selected interval. */
export interface PriceLine {
  /** "$9" — formatted manifest amount. */
  amount: string;
  /** "/mo" | "/yr". */
  per: string;
  /** "$7.50/mo effective" on annual cards; absent on monthly + $0. */
  note?: string;
}

/**
 * Price line for a purchasable tier at an interval. Falls back to the
 * other interval when one isn't offered (Free has no annual price —
 * the card keeps showing $0). Returns null only when the manifest has
 * no price at all (team/enterprise).
 */
export function priceLineFor(
  tier: TierDefinition,
  interval: BillingInterval,
  currency: Currency = 'USD',
): PriceLine | null {
  const point = tier.prices[interval] ?? tier.prices.monthly ?? tier.prices.annual;
  if (!point) return null;
  const isAnnual = point === tier.prices.annual && tier.prices.annual !== null;
  const zero = currency === 'INR' ? point.inrPaise === 0 : point.usdCents === 0;
  if (zero) {
    return { amount: formatMoney({ usdCents: 0, inrPaise: 0 }, currency), per: '' };
  }
  if (isAnnual) {
    // The "/mo effective" note divides the SAME currency's annual
    // amount — mixing the two currencies here would invent a rate.
    const perMonth =
      currency === 'INR'
        ? { usdCents: 0, inrPaise: Math.round(point.inrPaise / 12) }
        : { usdCents: Math.round(point.usdCents / 12), inrPaise: 0 };
    return {
      amount: formatMoney(point, currency),
      per: '/yr',
      note: `${formatMoney(perMonth, currency)}/mo effective`,
    };
  }
  return { amount: formatMoney(point, currency), per: '/mo' };
}

/** The Founding Pro promo (D19 launch offer), straight off the manifest. */
export function foundingProPromo(): { hostTier: TierDefinition; promo: PromoDefinition } | null {
  for (const id of PRICING_TIER_ORDER) {
    const tier = TIER_MANIFEST[id];
    if (tier.promo) return { hostTier: tier, promo: tier.promo };
  }
  return null;
}

/**
 * One-sentence tier jobs (D19's "Job" column). Copy, not entitlement
 * data — the only per-tier strings that legitimately live outside the
 * manifest.
 */
export const TIER_JOBS: Readonly<Record<TierId, string>> = {
  free: 'See what’s noisy.',
  plus: 'Handle it yourself, unlimited.',
  pro: 'Automate recurring noise with explicit rules.',
  team: 'Do this together, with audit.',
  enterprise: 'Do this safely at scale.',
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
  'cleanup-actions': 'Cleanup verbs — Keep · Archive · Unsubscribe · Later · Delete',
  triage: 'Triage sessions',
  autopilot: 'Autopilot rules',
  brief: 'Daily Brief',
  screener: 'Screener',
  quiet: 'Quiet hours',
  snoozed: 'Later review queue',
  followups: 'Follow-ups',
};

/**
 * Card bullet lines, derived from the manifest. Free enumerates its
 * surfaces + quotas; each later tier shows "Everything in <prev>" plus
 * the capabilities and quota changes the manifest actually adds — so a
 * manifest edit (new capability, lifted limit) rewrites the cards.
 */
export function cardBullets(tier: TierDefinition): readonly string[] {
  const idx = PRICING_TIER_ORDER.indexOf(tier.id);
  const prev = idx > 0 ? TIER_MANIFEST[PRICING_TIER_ORDER[idx - 1] as TierId] : null;
  const bullets: string[] = [];

  if (!prev) {
    for (const capability of tier.capabilities) {
      if (capability === 'cleanup-actions' && tier.cleanupActionsLifetime !== null) {
        bullets.push(`${tier.cleanupActionsLifetime} lifetime cleanup actions to taste`);
      } else {
        bullets.push(CAPABILITY_LABELS[capability]);
      }
    }
  } else {
    bullets.push(`Everything in ${prev.name}`);
    for (const capability of tier.capabilities) {
      if (!prev.capabilities.includes(capability)) {
        bullets.push(CAPABILITY_LABELS[capability]);
      }
    }
    if (prev.cleanupActionsLifetime !== null && tier.cleanupActionsLifetime === null) {
      bullets.push('Unlimited cleanup actions');
    }
  }

  if (!prev || tier.inboxLimit !== prev.inboxLimit) {
    bullets.push(`${tier.inboxLimit} connected ${tier.inboxLimit === 1 ? 'inbox' : 'inboxes'}`);
  }
  if (!prev || tier.undoWindowDays !== prev.undoWindowDays) {
    bullets.push(`${tier.undoWindowDays}-day Activity Undo for Archive, Later, and Delete`);
  }

  return bullets;
}

/** A comparison-table row: label + one cell per tier in display order. */
export interface CompareRow {
  label: string;
  /** '✓-like truthy string, quota string, or null (em-dash cell). */
  values: readonly (string | null)[];
}

/**
 * The full comparison table, derived from the manifest:
 *   - one row per capability (`CAPABILITIES` order), cell = included?
 *     (the cleanup row shows the Free lifetime quota instead of a bare
 *     check — that quota is the Free→Plus upgrade trigger, D19);
 *   - quota rows (inboxes / undo window) from the manifest limits.
 */
export function compareRows(): readonly CompareRow[] {
  // Team and Enterprise have provisional Pro-equivalent values in the
  // entitlement manifest for administrative safety. Publishing those
  // placeholders as purchasable promises would be misleading, so the
  // launch comparison covers only Free / Plus / Pro. The unavailable
  // tiers remain visible below the cards as waitlist/contact rows.
  const tiers = comparablePricingTiers();

  const capabilityRows: CompareRow[] = CAPABILITIES.map((capability) => ({
    label: CAPABILITY_LABELS[capability],
    values: tiers.map((tier) => {
      if (!tier.capabilities.includes(capability)) return null;
      if (capability === 'cleanup-actions') {
        return tier.cleanupActionsLifetime === null
          ? 'Unlimited'
          : `${tier.cleanupActionsLifetime} lifetime`;
      }
      return 'Included';
    }),
  }));

  const quotaRows: CompareRow[] = [
    {
      label: 'Connected inboxes',
      values: tiers.map((tier) => String(tier.inboxLimit)),
    },
    {
      label: 'Activity Undo for Archive, Later, and Delete',
      values: tiers.map((tier) => `${tier.undoWindowDays} days`),
    },
  ];

  return [...capabilityRows, ...quotaRows];
}
