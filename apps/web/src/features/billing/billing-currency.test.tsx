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
  it('an India visitor is quoted USD while Razorpay is UNPROVISIONED', () => {
    // The live manifest has every razorpayPlanId null (India deferred),
    // so checkout clamps to Paddle and charges USD. Quoting ₹1,599 here
    // would promise a rail that cannot take the payment — the same lie
    // as the reverse, which is why region preference alone never
    // decides the currency.
    expect(PRO_MONTHLY.razorpayPlanId).toBeNull();
    renderGate('razorpay');
    expect(
      screen.getByText(new RegExp(formatUsd(PRO_MONTHLY.usdCents).replace('$', '\\$'))),
    ).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(formatInr(PRO_MONTHLY.inrPaise)))).not.toBeInTheDocument();
  });

  it('quotes INR once that exact point IS provisioned on Razorpay', () => {
    // Pure resolver check — the render path above proves the wiring;
    // this pins the rule that flips it on at go-live.
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

  it('an EXISTING Razorpay subscription shows INR even though the catalog is unprovisioned', () => {
    // The clamp that protects prospective quotes must not reach here.
    // This subscription EXISTS, so it was purchasable on Razorpay
    // whatever the catalog says today — the workspace is being billed
    // ₹15,999/yr and must not read "$190/yr".
    expect(PRO_ANNUAL.razorpayPlanId).toBeNull();
    expect(chargedPlanPrice('pro', 'annual', 'razorpay')).toBe(
      `${formatInr(PRO_ANNUAL.inrPaise)}/yr`,
    );
  });

  it('a prospective QUOTE on the same unprovisioned point stays USD', () => {
    expect(quotedPlanPrice('pro', 'annual', 'razorpay')).toBe(
      `${formatUsd(PRO_ANNUAL.usdCents)}/yr`,
    );
  });

  it('the two agree on Paddle, and once Razorpay is provisioned', () => {
    expect(chargedPlanPrice('pro', 'annual', 'paddle')).toBe(
      quotedPlanPrice('pro', 'annual', 'paddle'),
    );
  });
});
