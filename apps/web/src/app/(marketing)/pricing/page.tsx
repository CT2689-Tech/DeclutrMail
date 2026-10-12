// /pricing — public pricing page (D17 pricing leg; D19 ladder).
//
// Lives in the `(marketing)` group: no AuthProvider, no auth
// round-trip — the page renders instantly for logged-out visitors.
// All tier data derives from the entitlements manifest via
// `features/marketing/pricing`.

import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { headers } from 'next/headers';

import { BillingCurrencyProvider } from '@/features/billing/billing-currency';
import { defaultProviderForCountry } from '@/features/billing/billing-region';
import { loadPricingFlags } from '@/features/marketing/pricing/load-pricing-flags';
import { pricingPageMetadata } from '@/features/marketing/pricing/pricing-metadata';
import { PricingScreen } from '@/features/marketing/pricing/pricing-screen';
import '@/features/marketing/pricing/pricing.css';
import { COUNTRY_HEADER } from '@/middleware';

const PricingStory = dynamic(() =>
  import('@/features/marketing/pricing/pricing-story').then((mod) => mod.PricingStory),
);

export async function generateMetadata(): Promise<Metadata> {
  const flags = await loadPricingFlags();
  return pricingPageMetadata(flags.pricingV2, flags.passEnabled);
}

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
  const flags = await loadPricingFlags();
  const locale = country === 'IN' ? 'inr' : 'usd';
  return (
    <BillingCurrencyProvider provider={defaultProviderForCountry(country)}>
      {flags.pricingV2 ? (
        <PricingStory
          passEnabled={flags.passEnabled}
          locale={locale}
          now={new Date().toISOString()}
        />
      ) : (
        <PricingScreen />
      )}
    </BillingCurrencyProvider>
  );
}
