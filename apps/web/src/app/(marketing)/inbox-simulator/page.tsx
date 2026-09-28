import type { Metadata } from 'next';

import { InboxSimulatorScreen } from '@/features/marketing/inbox-simulator/inbox-simulator-screen';
import '@/features/marketing/inbox-simulator/inbox-simulator.css';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import { PageViewTracker } from '@/features/marketing/page-view-tracker';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Interactive product demo — DeclutrMail',
  description:
    'Try Senders and Triage with a made-up inbox. Open the sender inspector, filter and select senders, and preview cleanup actions. No signup or Gmail access required.',
  path: '/inbox-simulator',
  // This link gets shared into threads cold, so it unfurls as the preview
  // mechanism rather than the brand headline — see ./opengraph-image.tsx,
  // which Next attaches to both networks for this segment.
  routeOwnCard: true,
});

export default function InboxSimulatorPage() {
  return (
    <>
      <PageViewTracker page="inbox_simulator" />
      <InboxSimulatorScreen />
    </>
  );
}
