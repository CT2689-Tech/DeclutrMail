import type { Metadata } from 'next';

import { InboxSimulatorScreen } from '@/features/marketing/inbox-simulator/inbox-simulator-screen';
import '@/features/marketing/inbox-simulator/inbox-simulator.css';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import { PageViewTracker } from '@/features/marketing/page-view-tracker';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Interactive inbox simulator — DeclutrMail',
  description:
    'Try DeclutrMail’s Plus/Pro Triage row and action-preview flow on a synthetic inbox. Free uses the same cleanup verbs in Senders. No signup or Gmail access.',
  path: '/inbox-simulator',
});

export default function InboxSimulatorPage() {
  return (
    <>
      <PageViewTracker page="inbox_simulator" />
      <InboxSimulatorScreen />
    </>
  );
}
