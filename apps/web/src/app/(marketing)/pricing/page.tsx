// /pricing — public pricing page (D17 pricing leg; D19 ladder).
//
// Lives in the `(marketing)` group: no AuthProvider, no auth
// round-trip — the page renders instantly for logged-out visitors.
// All tier data derives from the entitlements manifest via
// `features/marketing/pricing`.

import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { BillingCurrencyProvider } from '@/features/billing/billing-currency';
import { defaultProviderForCountry } from '@/features/billing/billing-region';
import { PricingScreen } from '@/features/marketing/pricing/pricing-screen';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import { COUNTRY_HEADER } from '@/middleware';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Pricing — DeclutrMail',
  description:
    'Free includes manual sender cleanup, Plus removes the monthly limit and adds the Screener, Autopilot and Quiet hours, and Pro adds the Daily Brief, Follow-ups and more inboxes.',
  path: '/pricing',
  markdownAlternate: '/pricing.md',
});

/**
 * DYNAMIC ON PURPOSE (Option A′, founder 2026-08-14). The billing rail
 * is read here rather than in the root layout, which now prerenders the
 * rest of the public site. `/pricing` is the page where someone decides
 * to pay, so it quotes the rail the checkout will actually charge —
 * INR for India (live-provisioned since 2026-07-25), USD elsewhere.
 * Resolving that on the client instead would flash the wrong price.
 */
export default async function PricingPage() {
  const country = (await headers()).get(COUNTRY_HEADER);
  return (
    <BillingCurrencyProvider provider={defaultProviderForCountry(country)}>
      <PricingScreen />
    </BillingCurrencyProvider>
  );
}
