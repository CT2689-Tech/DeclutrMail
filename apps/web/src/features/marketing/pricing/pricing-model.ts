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

/** $0 / $9 / $7.50 — whole dollars unless the amount has real cents. */
export function formatUsd(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
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
export function priceLineFor(tier: TierDefinition, interval: BillingInterval): PriceLine | null {
  const point = tier.prices[interval] ?? tier.prices.monthly ?? tier.prices.annual;
  if (!point) return null;
  const isAnnual = point === tier.prices.annual && tier.prices.annual !== null;
  if (point.usdCents === 0) {
    return { amount: formatUsd(0), per: '' };
  }
  if (isAnnual) {
    return {
      amount: formatUsd(point.usdCents),
      per: '/yr',
      note: `${formatUsd(Math.round(point.usdCents / 12))}/mo effective`,
    };
  }
  return { amount: formatUsd(point.usdCents), per: '/mo' };
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
  plus: 'Handle it yourself, without limits.',
  pro: 'Let DeclutrMail keep it clean.',
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
    bullets.push(`${tier.undoWindowDays}-day undo window`);
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
  const tiers = pricingTiers();

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
      label: 'Undo window',
      values: tiers.map((tier) => `${tier.undoWindowDays} days`),
    },
  ];

  return [...capabilityRows, ...quotaRows];
}
