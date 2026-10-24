import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SenderRuleLibraryScope } from './sender-rule-library';
import {
  AUTO_ARCHIVE_LOW_ENGAGEMENT,
  PENDING_SUGGESTIONS,
  PRESET_RULES_ALL_FIVE,
} from './fixtures';
import { AutopilotRoute } from './autopilot-screen';
import { autopilotKeys } from './api/query-keys';

const route = new URLSearchParams(location.search).get('scenario') === 'route';
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: route ? Infinity : 0 },
    mutations: { retry: false },
  },
});
if (route) {
  client.setQueryData(autopilotKeys.rules(), PRESET_RULES_ALL_FIVE);
  client.setQueryData(autopilotKeys.patternSuggestion(), null);
  client.setQueryData([...autopilotKeys.pendingSuggestions(), 'page', 'fixture-mailbox', null], {
    data: PENDING_SUGGESTIONS,
    meta: { total: PENDING_SUGGESTIONS.length, pagination: { hasMore: false, nextCursor: null } },
  });
  document.documentElement.dataset.theme =
    new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    {route && <span id="dm-app-theme" hidden />}
    <main
      style={{
        padding: route ? 0 : '28px clamp(16px,3vw,40px)',
        maxWidth: 1200,
        margin: '0 auto',
        fontFamily: 'var(--dm-font-sans)',
        // Match AppShell: clipping must not hide a failed viewport assertion.
        overflowX: route ? 'hidden' : undefined,
      }}
    >
      {route ? (
        <AutopilotRoute />
      ) : (
        <SenderRuleLibraryScope
          mailboxId="fixture-mailbox"
          presetRules={[{ ...AUTO_ARCHIVE_LOW_ENGAGEMENT, enabled: true, mode: 'active' }]}
          presetsAvailable
        />
      )}
    </main>
  </QueryClientProvider>,
);
