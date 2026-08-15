import type { Metadata } from 'next';
import { headers } from 'next/headers';

import '@/features/marketing/landing/landing.css';
import { BillingCurrencyProvider } from '@/features/billing/billing-currency';
import { defaultProviderForCountry } from '@/features/billing/billing-region';
import { COUNTRY_HEADER } from '@/middleware';
import { Hero } from '@/features/marketing/landing/hero';
import {
  GmailCompanion,
  HowItWorks,
  PrivacyDesk,
  Problem,
  ProductTour,
  Ritual,
} from '@/features/marketing/landing/sections';
import { PricingTeaser } from '@/features/marketing/landing/pricing-teaser';
import { Faq } from '@/features/marketing/landing/faq';
import { FinalCta } from '@/features/marketing/landing/footer';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

/**
 * Public landing page at `/` (D134 structure, D223 locked headline).
 *
 * Renders inside the `(marketing)` route group — NO AuthProvider in
 * the chain, no auth round-trip before paint. The only session
 * awareness is intentionally absent; auth CTAs start Google OAuth directly.
 *
 * Section order follows D134, trimmed to the launch surface:
 * hero → trust strip → problem → how-it-works → ritual (K/A/U/L/D)
 * → privacy posture → pricing teaser → FAQ → final CTA → footer.
 * D136 still ships no testimonials without first-party evidence. Product
 * comparisons live on their source-backed dedicated routes.
 */

const TITLE = 'Preview Gmail cleanup by sender — DeclutrMail';
const DESCRIPTION =
  'Review Gmail by sender with Keep, Archive, Unsubscribe, Later, and Delete. See the exact count and Gmail changes before a manual move, then verify in Activity.';

// metadataBase is inherited from the root layout (D128 origin).
export const metadata: Metadata = marketingPageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/',
});

/**
 * DYNAMIC ON PURPOSE — one of two public pages that is (Option A′,
 * founder 2026-08-14; the other is `/pricing`).
 *
 * `PricingTeaser` quotes real amounts, and since 2026-07-25 the India
 * rail is live-provisioned (`razorpayPlanId` is populated for every paid
 * point), so an India-geo visitor is genuinely quoted and charged INR.
 * Prerendering this page would bake in the Paddle/USD default and show
 * an Indian visitor `$9` here and `₹749` one click later on /pricing —
 * the landing page contradicting the price the purchase then charges,
 * which is exactly the defect `pricing-teaser.tsx`'s own docblock exists
 * to prevent.
 *
 * The 30 public pages that quote no price DO prerender; this read costs
 * only the two that do. If the founder later accepts a USD-only landing
 * teaser, deleting this read is all it takes to make `/` static.
 */
export default async function LandingPage() {
  const country = (await headers()).get(COUNTRY_HEADER);
  return (
    <div className="dm-mkt">
      <div className="dm-mkt-shell">
        <Hero />
      </div>
      <Problem />
      <HowItWorks />
      <Ritual />
      <PrivacyDesk />
      <ProductTour />
      <GmailCompanion />
      <BillingCurrencyProvider provider={defaultProviderForCountry(country)}>
        <PricingTeaser />
      </BillingCurrencyProvider>
      <Faq />
      <FinalCta />
    </div>
  );
}
