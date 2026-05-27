// /billing — pricing tiers + subscription management (D17–D21, D77, D81).
//
// Tiers are Free / Plus / Pro. Pro gating is referenced by Screener
// (D77), Followups (D89), and Autopilot custom rules. Until the
// billing screen lands, this stub routes the user back to Settings.

import { RoutePlaceholder } from '@/features/route-placeholder/route-placeholder';

export const metadata = {
  title: 'Billing — DeclutrMail',
};

export default function BillingPage() {
  return (
    <RoutePlaceholder
      status="Planned for V2.1"
      title="Plan & billing"
      description={
        <>
          Compare Free, Plus, and Pro tiers, swap plans, and manage your subscription. We will carry
          your existing entitlements across when this lands.
        </>
      }
      decisions={['D17', 'D18', 'D19', 'D20', 'D21', 'D77', 'D81']}
      primaryCta={{ href: '/settings', label: 'Open Settings' }}
    />
  );
}
