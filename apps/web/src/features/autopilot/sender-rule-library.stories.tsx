import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SenderRuleLibraryScope } from './sender-rule-library';
import { FIXTURE_RULES } from './sender-rule-browser-data.fixture';
import { AUTO_ARCHIVE_LOW_ENGAGEMENT } from './fixtures';
const meta = {
  title: 'Autopilot/SenderRuleLibrary',
  component: SenderRuleLibraryScope,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
};
export default meta;
const story = (rules = FIXTURE_RULES) => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(['autopilot-sender-rules', 'fixture-mailbox'], rules);
  return (
    <QueryClientProvider client={client}>
      <div style={{ padding: 28, fontFamily: 'var(--dm-font-sans)' }}>
        <SenderRuleLibraryScope
          mailboxId="fixture-mailbox"
          presetRules={[{ ...AUTO_ARCHIVE_LOW_ENGAGEMENT, mode: 'active', enabled: true }]}
          presetsAvailable
        />
      </div>
    </QueryClientProvider>
  );
};
export const GrowingLibrary = { render: () => story() };
export const FirstRules = { render: () => story(FIXTURE_RULES.slice(0, 2)) };
export const Empty = { render: () => story([]) };
