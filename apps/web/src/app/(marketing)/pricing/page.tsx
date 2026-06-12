// /pricing — public pricing page (D17 pricing leg; D19 ladder).
//
// Lives in the `(marketing)` group: no AuthProvider, no auth
// round-trip — the page renders instantly for logged-out visitors.
// All tier data derives from the entitlements manifest via
// `features/marketing/pricing`.

import type { Metadata } from 'next';

import { PricingScreen } from '@/features/marketing/pricing/pricing-screen';

export const metadata: Metadata = {
  title: 'Pricing — DeclutrMail',
  description:
    'Free shows you what’s noisy. Plus lets you clean it yourself. Pro keeps it clean for you. Five verbs, every action undoable, full bodies fetched: 0.',
};

export default function PricingPage() {
  return <PricingScreen />;
}
