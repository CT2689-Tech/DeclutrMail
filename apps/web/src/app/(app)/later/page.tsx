// /later — canonical sender-level Later review surface (D78–D80, D245).
//
// The internal capability, API, and worker names remain `snoozed` for
// compatibility. User-facing product language consistently says Later.

import { TierGate } from '@/features/billing/tier-gate';
import { SnoozedScreen } from '@/features/snoozed/snoozed-screen';

export const metadata = {
  title: 'Later — DeclutrMail',
};

export default function LaterPage() {
  return (
    <TierGate
      capability="snoozed"
      title="Later"
      pitch="Every sender you deferred with Later, in one list — grouped by when they wake, with wake-now and scheduling controls."
      bullets={[
        'See everything parked with Later at a glance',
        'Wake a sender now or change its wake time',
        'Grouped by wake time, so nothing slips',
      ]}
      footnote="Your Later senders are never hidden: their mail sits in the DeclutrMail/Later label in Gmail, where you can read or move it any time."
    >
      <SnoozedScreen />
    </TierGate>
  );
}
