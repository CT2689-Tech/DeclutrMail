// Refund Policy. The published window is the launch deck, filled from
// POLICY.refundWindowDays.

import type { Metadata } from 'next';

import { RefundsV2 } from '@/features/marketing/pricing/refunds-v2';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Refund Policy — DeclutrMail',
  description:
    'How refunds and cancellations work for DeclutrMail subscriptions, whether you purchased through Paddle (global) or Razorpay (India).',
  path: '/refunds',
});

export default function RefundPolicyPage() {
  return <RefundsV2 />;
}
