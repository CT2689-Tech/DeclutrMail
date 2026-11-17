/**
 * In-app upgrade paths quote the currency checkout charges (D117).
 *
 * The tier gate, the 402 upgrade modal, and the Autopilot entitlement
 * nudge all quote a plan price and deep-link straight into checkout, so
 * each must quote what checkout will charge. The manifest amounts
 * themselves are pinned in pricing-model.test.ts.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { chargedPlanPrice, quotedPlanPrice } from './billing-model';
import { currencyForPricePoint, formatUsd } from '@/features/marketing/pricing/pricing-model';

vi.mock('@/features/auth/api/use-tier', () => ({
  useTier: () => ({ tier: 'free', cleanupRemaining: 0 }),
}));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));

import { TierGate } from './tier-gate';

const PRO_MONTHLY = TIER_MANIFEST.pro.prices.monthly!;

describe('in-app upgrade nudges quote the charged currency (D117)', () => {
  it('defaults to USD — tests/Storybook/non-Vercel hosts have no geo', () => {
    // `brief` — a capability whose granting tier is Pro, so the PRO_MONTHLY
    // pin stays meaningful. (D251 moved `autopilot` to Plus; the
    // Plus-quote path is covered in tier-gate.test.tsx.)
    render(
      <TierGate capability="brief" title="Daily Brief" pitch="Get your morning inbox summary.">
        <div>unlocked</div>
      </TierGate>,
    );
    expect(
      screen.getByText(new RegExp(formatUsd(PRO_MONTHLY.usdCents).replace('$', '\\$'))),
    ).toBeInTheDocument();
  });
});

describe('quote vs charge are different questions (D117)', () => {
  it('the two agree on Paddle', () => {
    expect(chargedPlanPrice('pro', 'annual')).toBe(quotedPlanPrice('pro', 'annual'));
  });
});

describe('a founding subscription is billed the promo point (D126)', () => {
  const PROMO = TIER_MANIFEST.pro.promo!;
  const PRO_ANNUAL = TIER_MANIFEST.pro.prices.annual!;

  it('shows the LOCKED promo price, not the standard tier price', () => {
    // A Founding Pro member pays $129/yr. Reading the standard pro
    // annual point states a charge that never happens — and contradicts
    // the founding banner on the same screen, which quotes the promo.
    expect(PROMO.annual.usdCents).not.toBe(PRO_ANNUAL.usdCents);
    expect(chargedPlanPrice('pro', 'annual', true)).toBe(`${formatUsd(PROMO.annual.usdCents)}/yr`);
  });

  it('a non-founding subscriber on the same tier still sees the standard price', () => {
    expect(chargedPlanPrice('pro', 'annual', false)).toBe(`${formatUsd(PRO_ANNUAL.usdCents)}/yr`);
  });

  it('the promo is annual-only — a monthly founding record bills the standard line', () => {
    expect(chargedPlanPrice('pro', 'monthly', true)).toBe(
      `${formatUsd(TIER_MANIFEST.pro.prices.monthly!.usdCents)}/mo`,
    );
  });

  it('quotes INR from the price point for a verified India visitor under pricing v2', () => {
    expect(
      currencyForPricePoint(
        { inrPaise: 199900 },
        { pricingV2: true, country: 'IN', indiaCheckoutOpen: true },
      ),
    ).toBe('INR');
    expect(currencyForPricePoint({ inrPaise: 199900 }, { pricingV2: true, country: 'IN' })).toBe(
      'USD',
    );
    expect(
      currencyForPricePoint(
        { inrPaise: 199900 },
        { pricingV2: true, country: 'US', indiaCheckoutOpen: true },
      ),
    ).toBe('USD');
    expect(currencyForPricePoint({ inrPaise: 199900 })).toBe('USD');
    expect(
      currencyForPricePoint(
        { inrPaise: 0, usdCents: 0 },
        { pricingV2: true, country: 'IN', indiaCheckoutOpen: true },
      ),
    ).toBe('INR');
  });
});
