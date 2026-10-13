import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ActivitySupportBundleDialog } from './support-bundle-dialog';

export default {
  title: 'Activity/SupportBundleDialog',
  component: ActivitySupportBundleDialog,
  parameters: { layout: 'fullscreen' },
};

function Review({ invalidRange = false }: { invalidRange?: boolean }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <ActivitySupportBundleDialog
        mailboxEmail="review@example.test"
        mailboxId="11111111-1111-4111-8111-111111111111"
        initialFilters={
          invalidRange ? { dateFrom: '2026-10-13T00:00:00Z', dateTo: '2026-10-01T00:00:00Z' } : {}
        }
        onClose={() => {}}
      />
    </QueryClientProvider>
  );
}

export const Default = { render: () => <Review /> };
export const InvalidRange = { render: () => <Review invalidRange /> };
