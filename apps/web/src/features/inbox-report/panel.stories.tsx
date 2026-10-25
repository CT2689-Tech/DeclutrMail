import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InboxReportDto } from '@declutrmail/shared/inbox-report';
import { InboxReportPanel } from './panel';

const report: InboxReportDto = {
  generatedAt: '2026-10-24T16:00:00.000Z',
  mailboxSizeBucket: '1_to_5gb',
  insights: [
    { id: 'mostly_unread_share', pct: 49, senderCount: 2, sweeperExcluded: 0, window: '90d' },
    { id: 'years_deep', oldestYear: 2012, olderPct: 70 },
    { id: 'large_mail', bytes: 1_200_000_000, count: 12, top10Bytes: 800_000_000 },
  ],
  fix: { senderKeys: ['sample-one', 'sample-two'], sendersCount: 2, inboxEmailCount: 24 },
  receivedCount: 1670,
  totalBytes: 1_600_000_000,
  fallbackSenderCount: 2,
  variant: 'full',
};
function ReportStory({ fallback = false, empty = false, historical = false }) {
  const [client] = useState(() => new QueryClient());
  const [dismissed, setDismissed] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const value: InboxReportDto = empty
    ? {
        ...report,
        variant: 'fallback',
        receivedCount: 0,
        fix: { senderKeys: [], sendersCount: 0, inboxEmailCount: 0 },
        fallbackSenderCount: 0,
      }
    : {
        ...report,
        variant: fallback ? 'fallback' : 'full',
        insights: historical ? report.insights.slice(1) : report.insights,
      };
  return (
    <QueryClientProvider client={client}>
      <div style={{ maxWidth: 1000, margin: '24px auto', padding: 16 }}>
        <p>Sample report · synthetic email · no Gmail connection</p>
        <InboxReportPanel
          report={value}
          mailboxEmail="sample@example.test"
          dismissed={dismissed}
          onDismiss={() => setDismissed(true)}
          onReopen={() => setDismissed(false)}
          onReview={() => setReviewing(true)}
          senderNames={{
            'sample-one': { name: 'Sample Weekly' },
            'sample-two': { name: 'Sample Deals' },
          }}
          onFixConfirmed={() => {}}
        />
        {reviewing && (
          <p role="status">
            Review requested for Sample Weekly and Sample Deals. No email changed.
          </p>
        )}
      </div>
    </QueryClientProvider>
  );
}
const meta = {
  title: 'InboxReport/Panel',
  component: ReportStory,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ReportStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Full: Story = {};
export const Historical: Story = { args: { historical: true } };
export const Fallback: Story = { args: { fallback: true } };
export const Empty: Story = { args: { empty: true } };
