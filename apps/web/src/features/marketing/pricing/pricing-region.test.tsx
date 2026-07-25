/**
 * Public pricing follows the SAME rail the app charges on (D117).
 *
 * Marketing and the app used to answer "what does Pro cost?" from
 * different places: every in-app surface resolved the visitor's region,
 * while /pricing and the landing teaser were hardcoded USD. Today that
 * is invisible — every `razorpayPlanId` is null, so both sides say $19 —
 * but it becomes a public contradiction the moment the Razorpay catalog
 * is provisioned: /pricing quoting "$19/mo" over a checkout charging
 * ₹1,599.
 *
 * The manifest is mocked with a PARTIALLY provisioned catalog, because
 * that is the state a go-live actually produces: Pro's standard points
 * ship on Razorpay first, the Founding Pro promo and Plus do not. One
 * fixture therefore proves both halves — the surfaces follow the rail
 * where it exists, and clamp back to USD where it does not.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type * as Entitlements from '@declutrmail/shared/entitlements';

import { storeConsent } from '@/lib/cookie-consent';

const h = vi.hoisted(() => ({ push: vi.fn(), track: vi.fn().mockResolvedValue(undefined) }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock('@/lib/posthog', () => ({ track: h.track }));
vi.mock('@/lib/api/waitlist', () => ({ joinWaitlist: vi.fn() }));

// Pro monthly + annual gain a Razorpay id. Plus and the Founding Pro
// promo stay unprovisioned — they are the clamp's witnesses.
vi.mock('@declutrmail/shared/entitlements', async (importOriginal) => {
  const actual = await importOriginal<typeof Entitlements>();
  const pro = actual.TIER_MANIFEST.pro;
  return {
    ...actual,
    TIER_MANIFEST: {
      ...actual.TIER_MANIFEST,
      pro: {
        ...pro,
        prices: {
          monthly: { ...pro.prices.monthly!, razorpayPlanId: 'plan_test_pro_monthly' },
          annual: { ...pro.prices.annual!, razorpayPlanId: 'plan_test_pro_annual' },
        },
      },
    },
  };
});

import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { BillingCurrencyProvider } from '@/features/billing/billing-currency';
import { PricingTeaser } from '@/features/marketing/landing/pricing-teaser';

import { formatInr, formatUsd } from './pricing-model';
import { PricingScreen } from './pricing-screen';

const PRO_MONTHLY = TIER_MANIFEST.pro.prices.monthly!;
const PRO_ANNUAL = TIER_MANIFEST.pro.prices.annual!;
const PLUS_MONTHLY = TIER_MANIFEST.plus.prices.monthly!;
const PROMO = TIER_MANIFEST.pro.promo!;

function renderIn(provider: 'paddle' | 'razorpay', node: React.ReactNode) {
  storeConsent('all');
  return render(<BillingCurrencyProvider provider={provider}>{node}</BillingCurrencyProvider>);
}

describe('the landing teaser quotes the visitor rail (D117)', () => {
  it('shows INR for a provisioned point and USD for one that is not', () => {
    const { container } = renderIn('razorpay', <PricingTeaser />);
    const text = container.textContent ?? '';

    expect(text).toContain(formatInr(PRO_MONTHLY.inrPaise));
    // Plus has no Razorpay id — quoting ₹749 would promise a rail that
    // cannot take the payment.
    expect(text).toContain(formatUsd(PLUS_MONTHLY.usdCents));
    expect(text).not.toContain(formatInr(PLUS_MONTHLY.inrPaise));
    // Same for the Founding Pro promo, a separate SKU with its own id.
    expect(text).toContain(formatUsd(PROMO.annual.usdCents));
    expect(text).not.toContain(formatInr(PROMO.annual.inrPaise));
  });

  it('stays entirely USD outside India', () => {
    const { container } = renderIn('paddle', <PricingTeaser />);
    const text = container.textContent ?? '';
    expect(text).toContain(formatUsd(PRO_MONTHLY.usdCents));
    expect(text).not.toContain('₹');
  });
});

describe('/pricing quotes the visitor rail (D117)', () => {
  it('prices Pro in INR while an unprovisioned tier stays USD on the SAME page', () => {
    // The mixed page is the point: the clamp is per price point, not
    // per visitor, so one page legitimately carries both currencies —
    // each naming the rail that exact plan is bought on.
    renderIn('razorpay', <PricingScreen />);
    expect(screen.getByText(formatInr(PRO_MONTHLY.inrPaise))).toBeInTheDocument();
    expect(screen.getByText(formatUsd(PLUS_MONTHLY.usdCents))).toBeInTheDocument();
    expect(screen.queryByText(formatUsd(PRO_MONTHLY.usdCents))).not.toBeInTheDocument();
  });

  it('the founding banner never mixes currencies across its two price points', () => {
    // "₹10,999/yr instead of $190/yr" would read as a discount between
    // two currencies. The promo is unprovisioned here, so BOTH of the
    // banner's amounts must clamp to USD together.
    renderIn('razorpay', <PricingScreen />);
    const banner = screen.getByRole('complementary', { name: PROMO.name });
    expect(banner).toHaveTextContent(formatUsd(PROMO.annual.usdCents));
    expect(banner).toHaveTextContent(formatUsd(PRO_ANNUAL.usdCents));
    expect(banner).not.toHaveTextContent('₹');
  });

  it('prices Pro in USD for everyone else', () => {
    renderIn('paddle', <PricingScreen />);
    expect(screen.getByText(formatUsd(PRO_MONTHLY.usdCents))).toBeInTheDocument();
    expect(screen.queryByText(formatInr(PRO_MONTHLY.inrPaise))).not.toBeInTheDocument();
  });
});
