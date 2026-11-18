/**
 * Region currency reaches the IN-APP UPGRADE PATHS (D117).
 *
 * The checkout panel was fixed first, but it is not the only surface
 * that quotes a price immediately before sending someone to a charge:
 * the tier gate, the 402 upgrade modal, and the Autopilot entitlement
 * nudge all quote a plan price and deep-link straight into checkout.
 * Each one that assumes USD is a place an India-bound user reads a
 * dollar price and is then charged rupees.
 *
 * These assert the CONTEXT reaches each surface — the launch amounts
 * themselves come from the shared pricing config.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  launchPriceDisplay,
  PLUS_ANNUAL_2026_10,
  plusAmount,
  priceLine,
} from '@declutrmail/shared/entitlements';

import { BillingCurrencyProvider } from './billing-currency';
import { chargedPlanPrice, quotedPlanPrice } from './billing-model';
import { currencyForPricePoint, formatUsd } from '@/features/marketing/pricing/pricing-model';

vi.mock('@/features/auth/api/use-tier', () => ({
  useTier: () => ({ tier: 'free', cleanupRemaining: 0 }),
}));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));

import { TierGate } from './tier-gate';

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// `screener` — a capability whose granting tier is Plus, the only plan
// launch pricing sells (D251 moved it to Plus).
function renderGate(provider?: 'paddle' | 'razorpay') {
  const gate = (
    <TierGate capability="screener" title="Screener" pitch="Hold new senders for review.">
      <div>unlocked</div>
    </TierGate>
  );
  return render(
    provider ? <BillingCurrencyProvider provider={provider}>{gate}</BillingCurrencyProvider> : gate,
  );
}

describe('in-app upgrade nudges quote the regional rail (D117)', () => {
  it('a Razorpay-routed visitor is quoted the INR launch price', () => {
    renderGate('razorpay');
    expect(
      screen.getByText(new RegExp(escape(priceLine(PLUS_ANNUAL_2026_10, 'inr')))),
    ).toBeVisible();
    expect(
      screen.queryByText(new RegExp(escape(launchPriceDisplay('usd').plusLine))),
    ).not.toBeInTheDocument();
  });

  it('clamps back to USD for a point with no Razorpay id', () => {
    // Fixture-free so it keeps testing the RULE rather than whatever the
    // catalog happens to hold: a future price added before its Razorpay
    // plan exists must quote the USD its checkout will charge.
    expect(currencyForPricePoint({ razorpayPlanId: 'plan_x' }, 'razorpay')).toBe('INR');
    expect(currencyForPricePoint({ razorpayPlanId: null }, 'razorpay')).toBe('USD');
    expect(currencyForPricePoint({ razorpayPlanId: 'plan_x' }, 'paddle')).toBe('USD');
  });

  it('tier gate quotes USD everywhere else', () => {
    renderGate('paddle');
    expect(screen.getByText(new RegExp(escape(launchPriceDisplay('usd').plusLine)))).toBeVisible();
  });

  it('defaults to USD with no provider — tests/Storybook/non-Vercel hosts have no geo', () => {
    renderGate();
    expect(screen.getByText(new RegExp(escape(launchPriceDisplay('usd').plusLine)))).toBeVisible();
  });
});

describe('quote vs charge are different questions (D117)', () => {
  it('an EXISTING INR Plus annual subscription is shown its own charged currency', () => {
    // A settled subscription states its charge as fact — the clamp that
    // protects prospective quotes must never reach it.
    expect(chargedPlanPrice('plus', 'annual', 'paddle', undefined, undefined, 'INR')).toBe(
      `${plusAmount('inr')}/yr`,
    );
  });

  it('a retired price is stated from the catalog amount, never re-derived', () => {
    // The old $90 Plus annual is no longer in the manifest; the API's
    // resolved charge is what the subscriber still pays.
    expect(chargedPlanPrice('plus', 'annual', 'paddle', 'pri_legacy', 9000)).toBe(
      `${formatUsd(9000)}/yr`,
    );
    // Without that amount there is no price to state — never a guess.
    expect(chargedPlanPrice('pro', 'annual', 'razorpay')).toBeNull();
  });

  it('the two agree on the launch Plus annual price', () => {
    expect(
      chargedPlanPrice('plus', 'annual', 'paddle', PLUS_ANNUAL_2026_10.paddlePriceId ?? undefined),
    ).toBe(quotedPlanPrice('plus', 'annual', 'paddle'));
    // Pro and monthly are not sold, so they have no quote.
    expect(quotedPlanPrice('pro', 'annual', 'paddle')).toBeNull();
    expect(quotedPlanPrice('plus', 'monthly', 'paddle')).toBeNull();
  });
});

describe('launch currency rule', () => {
  it('quotes INR from the price point for India when Razorpay is hidden', () => {
    expect(
      currencyForPricePoint({ razorpayPlanId: 'plan_x', inrPaise: 199900 }, 'paddle', {
        country: 'IN',
        indiaCheckoutOpen: true,
      }),
    ).toBe('INR');
    expect(
      currencyForPricePoint({ razorpayPlanId: 'plan_x', inrPaise: 199900 }, 'paddle', {
        country: 'IN',
      }),
    ).toBe('USD');
    expect(
      currencyForPricePoint({ razorpayPlanId: 'plan_x', inrPaise: 199900 }, 'paddle', {
        country: 'US',
        indiaCheckoutOpen: true,
      }),
    ).toBe('USD');
    expect(currencyForPricePoint({ razorpayPlanId: 'plan_x', inrPaise: 199900 }, 'paddle')).toBe(
      'USD',
    );
    expect(
      currencyForPricePoint({ razorpayPlanId: null, inrPaise: 0, usdCents: 0 }, 'paddle', {
        country: 'IN',
        indiaCheckoutOpen: true,
      }),
    ).toBe('INR');
  });
});
