import type { Metadata } from 'next';

import { WS1_COPY } from '@declutrmail/shared/copy/launch';
import { fillStory } from '@declutrmail/shared/entitlements';

import { marketingPageMetadata } from '@/features/marketing/page-metadata';

const CURRENT_DESCRIPTION =
  'Free includes manual sender cleanup. Plus adds Screener, Autopilot and Quiet hours with no monthly limit. Pro adds the Daily Brief, Follow-ups and more inboxes.';

/** Flag-off keeps today's description. Flag-on uses the launch deck sub. */
export function pricingPageMetadata(pricingV2: boolean): Metadata {
  return marketingPageMetadata({
    title: 'Pricing — DeclutrMail',
    description: pricingV2 ? fillStory(WS1_COPY['pricing.sub']) : CURRENT_DESCRIPTION,
    path: '/pricing',
    markdownAlternate: '/pricing.md',
  });
}
