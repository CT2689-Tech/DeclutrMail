import type { Metadata } from 'next';

import { WS3_COPY } from '@declutrmail/shared/copy/launch';

import { InboxSimulatorScreen } from '@/features/marketing/inbox-simulator/inbox-simulator-screen';
import '@/features/marketing/inbox-simulator/inbox-simulator.css';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import { PageViewTracker } from '@/features/marketing/page-view-tracker';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Gmail cleanup demo — try before connecting | DeclutrMail',
  description: WS3_COPY['ws3.pr1019.simulator.description'],
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
