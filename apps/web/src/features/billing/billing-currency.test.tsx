/**
 * Region currency reaches the IN-APP UPGRADE PATHS (D117).
 *
 * The checkout panel was fixed first, but it is not the only surface
 * that quotes a price immediately before sending someone to a charge:
 * the tier gate, the 402 upgrade modal, and the Autopilot entitlement
 * nudge all quote a plan price and deep-link straight into checkout.
 * Each one that assumes USD is a place an India-bound user reads
 * "$19/mo" and is then charged ₹1,599.
 *
 * These assert the CONTEXT reaches each surface — the manifest amounts
 * themselves are pinned in pricing-model.test.ts.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { BillingCurrencyProvider } from './billing-currency';
import { chargedPlanPrice, quotedPlanPrice } from './billing-model';
import {
  currencyForPricePoint,
  formatInr,
  formatUsd,
} from '@/features/marketing/pricing/pricing-model';

vi.mock('@/features/auth/api/use-tier', () => ({
  useTier: () => ({ tier: 'free', cleanupRemaining: 0 }),
}));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));

import { TierGate } from './tier-gate';

const PRO_MONTHLY = TIER_MANIFEST.pro.prices.monthly!;

function renderGate(provider: 'paddle' | 'razorpay') {
  return render(
    <BillingCurrencyProvider provider={provider}>
      <TierGate capability="autopilot" title="Autopilot" pitch="Automate recurring noise.">
        <div>unlocked</div>
      </TierGate>
    </BillingCurrencyProvider>,
  );
}

describe('in-app upgrade nudges quote the regional rail (D117)', () => {
  it('an India visitor is quoted INR now that Razorpay is provisioned', () => {
    // Razorpay went live 2026-07-25, so this point carries a plan id and
    // an India-routed checkout really does settle INR. Quoting "$19/mo"
    // over a ₹1,599 charge is the defect this whole seam exists to
    // prevent — in the direction that is now reachable.
    expect(PRO_MONTHLY.razorpayPlanId).not.toBeNull();
    renderGate('razorpay');
    expect(screen.getByText(new RegExp(formatInr(PRO_MONTHLY.inrPaise)))).toBeInTheDocument();
    expect(
      screen.queryByText(new RegExp(formatUsd(PRO_MONTHLY.usdCents).replace('$', '\\$'))),
    ).not.toBeInTheDocument();
  });

  it('clamps back to USD for a point with no Razorpay id', () => {
    // Fixture-free so it keeps testing the RULE rather than whatever the
    // catalog happens to hold: a future tier added before its Razorpay
    // plan exists must quote the USD its checkout will charge.
    expect(currencyForPricePoint({ razorpayPlanId: 'plan_x' }, 'razorpay')).toBe('INR');
    expect(currencyForPricePoint({ razorpayPlanId: null }, 'razorpay')).toBe('USD');
    expect(currencyForPricePoint({ razorpayPlanId: 'plan_x' }, 'paddle')).toBe('USD');
  });

  it('tier gate quotes USD everywhere else', () => {
    renderGate('paddle');
    expect(
      screen.getByText(new RegExp(formatUsd(PRO_MONTHLY.usdCents).replace('$', '\\$'))),
    ).toBeInTheDocument();
  });

  it('defaults to USD with no provider — tests/Storybook/non-Vercel hosts have no geo', () => {
    render(
      <TierGate capability="autopilot" title="Autopilot" pitch="Automate recurring noise.">
        <div>unlocked</div>
      </TierGate>,
    );
    expect(
      screen.getByText(new RegExp(formatUsd(PRO_MONTHLY.usdCents).replace('$', '\\$'))),
    ).toBeInTheDocument();
  });
});

describe('quote vs charge are different questions (D117)', () => {
  const PRO_ANNUAL = TIER_MANIFEST.pro.prices.annual!;

  it('an EXISTING Razorpay subscription is shown its own charged currency', () => {
    // A settled subscription states its provider as fact — the clamp
    // that protects prospective quotes must never reach it. The
    // distinction is invisible while the catalog agrees, so the pure
    // check below keeps it pinned.
    expect(chargedPlanPrice('pro', 'annual', 'razorpay')).toBe(
      `${formatInr(PRO_ANNUAL.inrPaise)}/yr`,
    );
  });

  it('a charge stays INR even for a point the catalog no longer offers', () => {
    // The case that separates the two functions: if Pro annual were
    // de-listed from Razorpay tomorrow, every existing subscriber is
    // still billed ₹15,999/yr and must not suddenly read "$190/yr".
    // `chargedPlanPrice` is unclamped by design; `quotedPlanPrice` is not.
    const delisted = { ...PRO_ANNUAL, razorpayPlanId: null };
    expect(currencyForPricePoint(delisted, 'razorpay')).toBe('USD');
    expect(chargedPlanPrice('pro', 'annual', 'razorpay')).toBe(
      `${formatInr(PRO_ANNUAL.inrPaise)}/yr`,
    );
  });

  it('the two agree on Paddle, and once Razorpay is provisioned', () => {
    expect(chargedPlanPrice('pro', 'annual', 'paddle')).toBe(
      quotedPlanPrice('pro', 'annual', 'paddle'),
    );
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
    expect(chargedPlanPrice('pro', 'annual', 'paddle', true)).toBe(
      `${formatUsd(PROMO.annual.usdCents)}/yr`,
    );
  });

  it('a non-founding subscriber on the same tier still sees the standard price', () => {
    expect(chargedPlanPrice('pro', 'annual', 'paddle', false)).toBe(
      `${formatUsd(PRO_ANNUAL.usdCents)}/yr`,
    );
  });

  it('carries the promo through to INR for a founding Razorpay member', () => {
    expect(chargedPlanPrice('pro', 'annual', 'razorpay', true)).toBe(
      `${formatInr(PROMO.annual.inrPaise)}/yr`,
    );
  });

  it('the promo is annual-only — a monthly founding record bills the standard line', () => {
    expect(chargedPlanPrice('pro', 'monthly', 'paddle', true)).toBe(
      `${formatUsd(TIER_MANIFEST.pro.prices.monthly!.usdCents)}/mo`,
    );
  });
});
