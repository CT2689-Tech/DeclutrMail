import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SenderRuleLibraryScope } from './sender-rule-library';
import { AUTO_ARCHIVE_LOW_ENGAGEMENT } from './fixtures';
const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main
      style={{
        padding: '28px clamp(16px,3vw,40px)',
        maxWidth: 1200,
        margin: '0 auto',
        fontFamily: 'var(--dm-font-sans)',
      }}
    >
      <SenderRuleLibraryScope
        mailboxId="fixture-mailbox"
        presetRules={[{ ...AUTO_ARCHIVE_LOW_ENGAGEMENT, enabled: true, mode: 'active' }]}
        presetsAvailable
      />
    </main>
  </QueryClientProvider>,
);
