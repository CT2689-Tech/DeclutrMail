import type { Metadata } from 'next';

import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import { InboxSimulatorScreen } from '@/features/marketing/inbox-simulator/inbox-simulator-screen';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Inbox simulator — try DeclutrMail before you connect Gmail',
  description:
    'Practice Keep, Archive, Unsubscribe, Later, and Delete on a mock inbox — no signup, nothing leaves your browser. Full bodies fetched: 0.',
  path: '/inbox-simulator',
});

/**
 * D133 pragmatic launch slice — interactive demo without wiring the
 * production triage mutation pipeline. Client island only.
 */
export default function InboxSimulatorPage() {
  return <InboxSimulatorScreen />;
}
