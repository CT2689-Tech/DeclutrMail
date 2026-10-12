// Refund Policy (D146) — public, static prose; the only client JS is
// the D159 page-view tracker island.
//
// Required by both payment providers (D117): Paddle (merchant of
// record outside India) and Razorpay (India) each require a published
// refund/cancellation policy.
//
// FOUNDER-CONFIRMED 2026-07-08 (D121): 30-day money-back guarantee on
// every paid plan, with a fair-use clause (one guarantee use per
// customer; bulk-consume-then-refund may be declined). This replaced
// the interim 14-day pro-rata default.

import type { Metadata } from 'next';

import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import { loadPricingFlags } from '@/features/marketing/pricing/load-pricing-flags';

import { RefundPolicyPage } from './refund-policy-surface';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Refund Policy — DeclutrMail',
  description:
    'How refunds and cancellations work for DeclutrMail subscriptions, whether you purchased through Paddle (global) or Razorpay (India).',
  path: '/refunds',
});

export default async function RefundPolicyRoute() {
  const flags = await loadPricingFlags();
  return <RefundPolicyPage pricingV2={flags.pricingV2} />;
}
