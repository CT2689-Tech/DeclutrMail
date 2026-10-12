import type { Metadata } from 'next';

import { WS1_COPY } from '@declutrmail/shared/copy/launch';
import { fillStory, isBillingPassEnabled } from '@declutrmail/shared/entitlements';

import { marketingPageMetadata } from '@/features/marketing/page-metadata';

const CURRENT_DESCRIPTION =
  'Free includes manual sender cleanup. Plus adds Screener, Autopilot and Quiet hours with no monthly limit. Pro adds the Daily Brief, Follow-ups and more inboxes.';

/** The pass sentence in `pricing.meta.description`. Dropped when the pass is off. */
const PASS_SENTENCE = 'The {passName} is {passPrice} once. ';

/**
 * USD only. Page metadata is not region-aware, so INR prices never land here.
 * Pass off drops the Backlog Pass sentence and keeps the rest.
 */
export function pricingMetaDescription(passEnabled: boolean): string {
  const full = WS1_COPY['pricing.meta.description'];
  return fillStory(passEnabled ? full : full.replace(PASS_SENTENCE, ''), 'usd');
}

/** Flag-off keeps today's description. Flag-on uses the launch meta description. */
export function pricingPageMetadata(
  pricingV2: boolean,
  passEnabled = isBillingPassEnabled(),
): Metadata {
  return marketingPageMetadata({
    title: 'Pricing — DeclutrMail',
    description: pricingV2 ? pricingMetaDescription(passEnabled) : CURRENT_DESCRIPTION,
    path: '/pricing',
    markdownAlternate: '/pricing.md',
  });
}
