// /pricing — public pricing page (D17 pricing leg; D19 ladder).
//
// Lives in the `(marketing)` group: no AuthProvider, no auth
// round-trip — the page renders instantly for logged-out visitors.
// All tier data derives from the entitlements manifest via
// `features/marketing/pricing`.

import type { Metadata } from 'next';

import { PricingScreen } from '@/features/marketing/pricing/pricing-screen';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Pricing — DeclutrMail',
  description:
    'Free is the full manual cleanup toolkit, Plus removes the cap and adds the Screener plus rules you approve, and Pro adds unattended automation. Full bodies fetched: 0.',
  path: '/pricing',
});

export default function PricingPage() {
  return <PricingScreen />;
}
