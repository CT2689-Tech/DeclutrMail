import type { Metadata } from 'next';

import { WS1_COPY } from '@declutrmail/shared/copy/launch';
import { fillStory } from '@declutrmail/shared/entitlements';

import { marketingPageMetadata } from '@/features/marketing/page-metadata';

/** USD only. Page metadata is not region-aware, so INR prices never land here. */
export function pricingPageMetadata(): Metadata {
  return marketingPageMetadata({
    title: 'Pricing — DeclutrMail',
    description: fillStory(WS1_COPY['pricing.meta.description'], 'usd'),
    path: '/pricing',
    markdownAlternate: '/pricing.md',
  });
}
