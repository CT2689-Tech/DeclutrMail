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
import { trustedVisitorCountry } from '@/features/billing/trusted-visitor-country';
import {
  indiaCheckoutReady,
  loadPricingFlags,
} from '@/features/marketing/pricing/load-pricing-flags';
import { pricingPageMetadata } from '@/features/marketing/pricing/pricing-metadata';
import { visitorPricingLocale } from '@/features/marketing/pricing/visitor-pricing-locale';
import { PricingStory } from '@/features/marketing/pricing/pricing-story';
import '@/features/marketing/pricing/pricing.css';

export const metadata: Metadata = pricingPageMetadata();

/**
 * DYNAMIC ON PURPOSE (Option A′, founder 2026-08-14). The billing rail
 * is read here rather than in the root layout, which now prerenders the
 * rest of the public site. `/pricing` quotes INR only when the edge
 * country is IN and India checkout is open. Otherwise it quotes USD.
 * An India visitor whose live prices are unbound still sees the pause
 * notice. Resolving that on the client instead would flash the wrong price.
 */
export default async function PricingPage() {
  const country = trustedVisitorCountry(await headers());
  const flags = await loadPricingFlags();
  const rupeePurchasesOpen = indiaCheckoutReady(
    flags.indiaCheckoutOpen,
    process.env.BILLING_GEO_HMAC_SECRET,
  );
  const locale = visitorPricingLocale({
    country,
    indiaCheckoutOpen: flags.indiaCheckoutOpen,
    geoSecret: process.env.BILLING_GEO_HMAC_SECRET,
  });
  return (
    <BillingCurrencyProvider provider={defaultProviderForCountry(country)} locale={locale}>
      <PricingStory
        locale={locale}
        now={new Date().toISOString()}
        rupeePurchasesOpen={rupeePurchasesOpen}
        inrPaused={country === 'IN' && !rupeePurchasesOpen}
      />
    </BillingCurrencyProvider>
  );
}
