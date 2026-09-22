'use client';

import { useRegionProvider } from '@/features/billing/billing-currency';
import { PricingTeaserView } from './pricing-teaser-view';

/** Context-aware variant for surfaces with a regional display provider. */
export function PricingTeaser() {
  return <PricingTeaserView provider={useRegionProvider()} />;
}
