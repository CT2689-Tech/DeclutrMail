// /snoozed — sender-level snooze review surface (D78–D80).
//
// Lists every sender in the Later bucket (mail in the
// DeclutrMail/Later label and/or an active wake timer), grouped by
// wake-time per D80, with Wake-now and set/extend snooze actions.

import { SnoozedScreen } from '@/features/snoozed/snoozed-screen';

export const metadata = {
  title: 'Snoozed — DeclutrMail',
};

export default function SnoozedPage() {
  return <SnoozedScreen />;
}
