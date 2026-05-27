// /snoozed — sender-level snooze queue (D78–D80).
//
// Stub until the feature lands. Snooze is sender-level at V2 (D78);
// message-level snooze is deferred. Routes the user to Senders, where
// "Snooze sender" will live in the per-row actions.

import { RoutePlaceholder } from '@/features/route-placeholder/route-placeholder';

export const metadata = {
  title: 'Snoozed — DeclutrMail',
};

export default function SnoozedPage() {
  return (
    <RoutePlaceholder
      status="Planned for V2.1"
      title="Snoozed senders"
      description={
        <>
          Hide a sender until a wake-time you choose. Future messages from them skip the queue until
          then; your existing inbox is untouched unless you opt to archive while snoozed.
        </>
      }
      decisions={['D78', 'D79', 'D80']}
      primaryCta={{ href: '/senders', label: 'Open Senders' }}
      secondaryCta={{ href: '/triage', label: 'Back to Triage' }}
    />
  );
}
