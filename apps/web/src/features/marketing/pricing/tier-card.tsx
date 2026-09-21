'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { TierDefinition } from '@declutrmail/shared/entitlements';

import { useRegionProvider } from '@/features/billing/billing-currency';
import { track } from '@/lib/posthog';
import { navigateToCheckout, navigateToFreeApp } from './cta';
import {
  cardBullets,
  currencyForPricePoint,
  formatMoney,
  priceLineFor,
  TIER_JOBS,
  type BillingInterval,
} from './pricing-model';

/**
 * One purchasable-tier card (D19). Every number on the card comes off
 * the manifest via the pricing model — no literals here.
 *
 * CTA semantics (per the D17 pricing leg):
 *   - Free → lazy auth probe: existing users return to /senders;
 *     signed-out visitors start OAuth.
 *   - Plus/Pro → the same probe, preserving plan/cycle/promo intent
 *     through /billing or OAuth (see cta.ts).
 */
export function TierCard({
  tier,
  interval,
  highlighted = false,
}: {
  tier: TierDefinition;
  interval: BillingInterval;
  highlighted?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // The card quotes the rail the CTA below it routes to (D117) —
  // clamped per price point, so an unprovisioned rail still shows the
  // USD that checkout will actually charge.
  const regionProvider = useRegionProvider();

  const price = priceLineFor(tier, interval, regionProvider);
  const promoActive = interval === 'annual' && tier.promo != null;
  // A COMPARISON has to be single-currency. Each price point clamps
  // independently, so a promo that is Paddle-only sitting beside a
  // standard annual that IS on Razorpay would render "$129/yr" struck
  // through "₹15,999/yr" — two currencies presented as a discount on one
  // another. The promo is the thing being bought, so its rail wins for
  // both halves.
  const promoCurrency = tier.promo
    ? currencyForPricePoint(tier.promo.annual, regionProvider)
    : null;
  const struckAmount =
    promoCurrency !== null && tier.prices.annual !== null
      ? formatMoney(tier.prices.annual, promoCurrency)
      : (price?.amount ?? null);
  const isFree = tier.prices.monthly?.usdCents === 0;

  async function onCta() {
    if (busy) return;
    setBusy(true);
    try {
      const selectedTier = isFree
        ? 'free'
        : tier.id === 'plus' || tier.id === 'pro'
          ? tier.id
          : null;
      if (selectedTier === null) return;
      void track('pricing_plan_selected', {
        tier: selectedTier,
        cycle: interval,
        promo: promoActive && tier.id === 'pro' ? 'foundingPro' : null,
      });
      if (isFree) {
        await navigateToFreeApp((path) => router.push(path));
        return;
      }
      if (tier.id !== 'plus' && tier.id !== 'pro') return;
      await navigateToCheckout((path) => router.push(path), {
        plan: tier.id,
        cycle: interval,
        ...(promoActive && tier.id === 'pro' ? { promo: 'foundingPro' as const } : {}),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dm-tier" data-highlighted={highlighted ? 'true' : undefined}>
      <div>
        <div className="dm-tier-name">
          <h2>{tier.name}</h2>
          {highlighted ? (
            // An OPINION label on purpose — never an empirical claim
            // ("Most popular" was false at zero customers).
            <span className="dm-tier-pill">Recommended</span>
          ) : null}
        </div>
        <p className="dm-tier-job">{TIER_JOBS[tier.id]}</p>
      </div>

      <div className="dm-tier-price">
        {promoActive && tier.promo ? (
          <>
            <div className="dm-tier-amount">
              <span>{formatMoney(tier.promo.annual, promoCurrency ?? 'USD')}</span>
              <span>/yr</span>
              {struckAmount ? <s>{struckAmount}</s> : null}
            </div>
            <p className="dm-tier-note" data-tone="promo">
              Limited launch price. Availability confirmed at checkout.
            </p>
          </>
        ) : price ? (
          <>
            <div className="dm-tier-amount">
              <span>{price.amount}</span>
              {price.per ? <span>{price.per}</span> : null}
            </div>
            <p className="dm-tier-note">
              {price.note ?? (isFree ? 'No card required' : 'Billed monthly, cancel anytime')}
            </p>
          </>
        ) : null}
      </div>

      <button type="button" className="dm-tier-cta" onClick={() => void onCta()} disabled={busy}>
        {busy ? 'One moment…' : isFree ? 'Start free' : `Get ${tier.name}`}
      </button>

      <ul className="dm-tier-features">
        {cardBullets(tier).map((line) => (
          <li key={line}>
            <CheckGlyph />
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CheckGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
