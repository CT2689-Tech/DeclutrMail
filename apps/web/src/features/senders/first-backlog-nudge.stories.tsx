import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FirstBacklogNudge } from './first-backlog-nudge';
function frame(data: unknown, loading = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (!loading) client.setQueryData(['senders', 'first-backlog'], data);
  return (
    <QueryClientProvider client={client}>
      <FirstBacklogNudge />
    </QueryClientProvider>
  );
}
const meta: Meta<typeof FirstBacklogNudge> = {
  title: 'Senders/FirstBacklogNudge',
  component: FirstBacklogNudge,
};
export default meta;
type Story = StoryObj<typeof meta>;
export const BiggestEligible: Story = {
  render: () => frame({ senderId: 'example', name: 'Example Journal', inboxEmails: 144 }),
};
export const NoEligible: Story = { render: () => frame(null) };
export const Loading: Story = { render: () => frame(undefined, true) };
