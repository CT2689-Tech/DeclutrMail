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
import { formatInr, formatUsd } from '@/features/marketing/pricing/pricing-model';

vi.mock('@/features/auth/api/use-tier', () => ({
  useTier: () => ({ tier: 'free', cleanupRemaining: 0 }),
}));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));

import { TierGate } from './tier-gate';

const PRO_MONTHLY = TIER_MANIFEST.pro.prices.monthly!;

function renderGate(currency: 'USD' | 'INR') {
  return render(
    <BillingCurrencyProvider currency={currency}>
      <TierGate capability="autopilot" title="Autopilot" pitch="Automate recurring noise.">
        <div>unlocked</div>
      </TierGate>
    </BillingCurrencyProvider>,
  );
}

describe('in-app upgrade nudges quote the regional rail (D117)', () => {
  it('tier gate quotes INR for an India-resolved visitor', () => {
    renderGate('INR');
    expect(screen.getByText(new RegExp(formatInr(PRO_MONTHLY.inrPaise)))).toBeInTheDocument();
  });

  it('tier gate quotes USD everywhere else', () => {
    renderGate('USD');
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
