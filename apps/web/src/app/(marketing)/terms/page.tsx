// Terms of Service (D146) — public, static prose; the only client JS
// is the D159 page-view tracker island.
//
// FOUNDER-CONFIRMED 2026-07-08 (D121 batch): governing law = India,
// courts of Mumbai (Section 10). Lawyer review remains deferred until
// the D146 validation threshold.

import type { Metadata } from 'next';

import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import { loadPricingFlags } from '@/features/marketing/pricing/load-pricing-flags';

import { TermsOfServicePage } from './terms-surface';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Terms of Service — DeclutrMail',
  description:
    'The terms that govern your use of DeclutrMail: service description, Gmail account requirement, plans and billing, acceptable use, and liability.',
  path: '/terms',
});

export default async function TermsOfServiceRoute() {
  const flags = await loadPricingFlags();
  return <TermsOfServicePage pricingV2={flags.pricingV2} />;
}
