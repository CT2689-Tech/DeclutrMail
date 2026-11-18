/**
 * In-app upgrade paths quote the currency checkout charges (D117).
 *
 * The tier gate, the 402 upgrade modal, and the Autopilot entitlement
 * nudge all quote a plan price and deep-link straight into checkout, so
 * each must quote what checkout will charge. The launch amounts
 * themselves come from the shared pricing config.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  launchPriceDisplay,
  PLUS_ANNUAL_2026_10,
  plusAmount,
} from '@declutrmail/shared/entitlements';

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

describe('in-app upgrade nudges quote the charged currency (D117)', () => {
  it('defaults to USD — tests/Storybook/non-Vercel hosts have no geo', () => {
    // `screener` — a capability whose granting tier is Plus, the only plan
    // launch pricing sells (D251 moved it to Plus).
    render(
      <TierGate capability="screener" title="Screener" pitch="Hold new senders for review.">
        <div>unlocked</div>
      </TierGate>,
    );
    expect(screen.getByText(new RegExp(escape(launchPriceDisplay('usd').plusLine)))).toBeVisible();
  });
});

describe('quote vs charge are different questions (D117)', () => {
  it('an EXISTING INR Plus annual subscription is shown its own charged currency', () => {
    // A settled subscription states its charge as fact — the clamp that
    // protects prospective quotes must never reach it.
    expect(chargedPlanPrice('plus', 'annual', undefined, undefined, 'INR')).toBe(
      `${plusAmount('inr')}/yr`,
    );
  });

  it('a retired price is stated from the catalog amount, never re-derived', () => {
    // The old $90 Plus annual is no longer in the manifest; the API's
    // resolved charge is what the subscriber still pays.
    expect(chargedPlanPrice('plus', 'annual', 'pri_legacy', 9000)).toBe(`${formatUsd(9000)}/yr`);
    // Without that amount there is no price to state — never a guess.
    expect(chargedPlanPrice('pro', 'annual')).toBeNull();
  });

  it('the two agree on the launch Plus annual price', () => {
    expect(chargedPlanPrice('plus', 'annual', PLUS_ANNUAL_2026_10.paddlePriceId ?? undefined)).toBe(
      quotedPlanPrice('plus', 'annual'),
    );
    // Pro and monthly are not sold, so they have no quote.
    expect(quotedPlanPrice('pro', 'annual')).toBeNull();
    expect(quotedPlanPrice('plus', 'monthly')).toBeNull();
  });
});

describe('launch currency rule', () => {
  it('quotes INR from the price point for a verified India visitor', () => {
    expect(
      currencyForPricePoint({ inrPaise: 199900 }, { country: 'IN', indiaCheckoutOpen: true }),
    ).toBe('INR');
    expect(currencyForPricePoint({ inrPaise: 199900 }, { country: 'IN' })).toBe('USD');
    expect(
      currencyForPricePoint({ inrPaise: 199900 }, { country: 'US', indiaCheckoutOpen: true }),
    ).toBe('USD');
    expect(currencyForPricePoint({ inrPaise: 199900 })).toBe('USD');
    expect(
      currencyForPricePoint(
        { inrPaise: 0, usdCents: 0 },
        { country: 'IN', indiaCheckoutOpen: true },
      ),
    ).toBe('INR');
  });
});
