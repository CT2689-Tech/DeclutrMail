/**
 * Public pricing outside the launch catalog quotes the currency Paddle
 * charges there: USD (D117).
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { storeConsent } from '@/lib/cookie-consent';

const h = vi.hoisted(() => ({ push: vi.fn(), track: vi.fn().mockResolvedValue(undefined) }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock('@/lib/posthog', () => ({ track: h.track }));
vi.mock('@/lib/api/waitlist', () => ({ joinWaitlist: vi.fn() }));

import { PricingTeaserView } from '@/features/marketing/landing/pricing-teaser-view';

import { formatInr, formatUsd } from './pricing-model';
import { PricingScreen } from './pricing-screen';

const PRO_MONTHLY = TIER_MANIFEST.pro.prices.monthly!;
const PLUS_ANNUAL = TIER_MANIFEST.plus.prices.annual!;

describe('the landing teaser', () => {
  it('stays entirely USD', () => {
    storeConsent('all');
    const { container } = render(<PricingTeaserView />);
    const text = container.textContent ?? '';
    expect(text).toContain(formatUsd(PRO_MONTHLY.usdCents));
    expect(text).not.toContain('₹');
  });
});

describe('/pricing', () => {
  it('opens on the annual cycle', () => {
    // Founder-locked 2026-08-02.
    storeConsent('all');
    render(<PricingScreen />);
    expect(screen.getByRole('button', { name: /^Annual/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Monthly$/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByText(formatUsd(PLUS_ANNUAL.usdCents))).toBeInTheDocument();
  });

  it('prices Pro in USD', () => {
    storeConsent('all');
    render(<PricingScreen />);
    fireEvent.click(screen.getByRole('button', { name: /^Monthly$/ }));
    expect(screen.getByText(formatUsd(PRO_MONTHLY.usdCents))).toBeInTheDocument();
    expect(screen.queryByText(formatInr(PRO_MONTHLY.inrPaise))).not.toBeInTheDocument();
  });
});
