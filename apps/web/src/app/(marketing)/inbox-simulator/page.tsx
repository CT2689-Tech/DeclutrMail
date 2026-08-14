import type { Metadata } from 'next';

import { InboxSimulatorScreen } from '@/features/marketing/inbox-simulator/inbox-simulator-screen';
import '@/features/marketing/inbox-simulator/inbox-simulator.css';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import { PageViewTracker } from '@/features/marketing/page-view-tracker';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Interactive inbox simulator — DeclutrMail',
  description:
    'Try DeclutrMail’s Triage row and action-preview flow on a synthetic inbox — the same components every plan uses. No signup or Gmail access.',
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
