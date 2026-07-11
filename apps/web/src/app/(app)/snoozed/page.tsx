// /snoozed — sender-level snooze review surface (D78–D80).
//
// Lists every sender in the Later bucket (mail in the
// DeclutrMail/Later label and/or an active wake timer), grouped by
// wake-time per D80, with Wake-now and set/extend snooze actions.
//
// Pro-only per the D19 manifest. Without the TierGate this page fired
// the snoozed query on free tier and rendered the API's 402 as a
// broken "Try again in a moment" error card that could never succeed
// (2026-07-10 dogfood). The gate shows the upgrade placeholder — and
// because free tier CAN still press Later in Triage, the footnote says
// exactly where that mail lives so nothing feels hidden or lost.

import { TierGate } from '@/features/billing/tier-gate';
import { SnoozedScreen } from '@/features/snoozed/snoozed-screen';

export const metadata = {
  title: 'Snoozed — DeclutrMail',
};

export default function SnoozedPage() {
  return (
    <TierGate
      capability="snoozed"
      title="Snoozed"
      pitch="Every sender you deferred with Later, in one list — grouped by when they wake, with wake-now and extend controls."
      bullets={[
        'See everything parked with Later at a glance',
        'Wake a sender now or extend its snooze',
        'Grouped by wake time, so nothing slips',
      ]}
      footnote="Your Later senders are never hidden: their mail sits in the DeclutrMail/Later label in Gmail, where you can read or move it any time."
    >
      <SnoozedScreen />
    </TierGate>
  );
}
