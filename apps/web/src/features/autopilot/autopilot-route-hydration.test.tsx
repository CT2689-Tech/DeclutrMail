import { act, fireEvent } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { dehydrate, hydrate, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';

import { AutopilotRoute } from './autopilot-screen';
import { autopilotKeys } from './api/query-keys';
import { PENDING_SUGGESTIONS, PRESET_RULES_ALL_FIVE, PRESET_RULES_ALL_PAUSED } from './fixtures';

vi.mock('@/features/auth/auth-provider', () => ({
  useOptionalAuth: () => ({ me: { activeMailboxId: 'mailbox-a', tier: 'pro' } }),
  getActiveMailboxEmail: () => 'active@example.com',
}));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@declutrmail/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Avatar: () => <span aria-hidden="true" />,
}));

let root: Root | undefined;
const clients: QueryClient[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  clients.forEach((client) => client.clear());
  clients.length = 0;
  document.body.innerHTML = '';
});

it.each(['suggestions', 'pattern'] as const)(
  'adopts %s finishing during HTML delivery without replacing server markup',
  async (optional) => {
    const server = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
    });
    const browser = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
    });
    clients.push(server, browser);
    server.setQueryData(
      autopilotKeys.rules(),
      optional === 'pattern' ? PRESET_RULES_ALL_PAUSED : PRESET_RULES_ALL_FIVE,
    );
    if (optional === 'suggestions') server.setQueryData(autopilotKeys.patternSuggestion(), null);
    else
      server.setQueryData([...autopilotKeys.pendingSuggestions(), 'page', 'mailbox-a', null], {
        data: [],
        meta: { total: 0, pagination: { hasMore: false } },
      });
    let finish!: (value: unknown) => void;
    const key =
      optional === 'suggestions'
        ? [...autopilotKeys.pendingSuggestions(), 'page', 'mailbox-a', null]
        : autopilotKeys.patternSuggestion();
    const pending = server.fetchQuery({
      queryKey: key,
      queryFn: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const state = dehydrate(server, {
      shouldDehydrateQuery: (query) => query.state.status !== 'error',
    });
    const container = document.createElement('div');
    document.body.append(container);
    container.innerHTML = renderToString(
      <QueryClientProvider client={server}>
        <AutopilotRoute />
      </QueryClientProvider>,
    );
    // The HTML was generated while the stream was pending, but the data arrives
    // before React begins hydrating that HTML in the browser.
    finish(
      optional === 'suggestions'
        ? {
            data: PENDING_SUGGESTIONS.slice(0, 1),
            meta: { total: 1, pagination: { hasMore: false } },
          }
        : {
            ruleId: PRESET_RULES_ALL_FIVE[0]!.id,
            presetKey: 'auto_archive_low_engagement',
            ruleName: 'Review low-engagement senders for Archive',
            actionKind: 'archive',
            scope: 'account',
            evidenceCount: 4,
            evidenceWindowDays: 30,
            dailyActionCap: 100,
          },
    );
    await pending;
    hydrate(browser, state);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(browser.getQueryData(key)).toMatchObject(
      optional === 'suggestions' ? { meta: { total: 1 } } : { evidenceCount: 4 },
    );
    const recovered = vi.fn();
    await act(async () => {
      root = hydrateRoot(
        container,
        <QueryClientProvider client={browser}>
          <AutopilotRoute />
        </QueryClientProvider>,
        { onRecoverableError: recovered },
      );
    });
    expect(recovered).not.toHaveBeenCalled();
    if (optional === 'pattern') {
      const next = container.querySelector<HTMLButtonElement>('[aria-label^="Show next notice"]');
      expect(next).not.toBeNull();
      fireEvent.click(next!);
    }
    expect(container.textContent).toContain(
      optional === 'suggestions' ? '1 on this page' : 'Watch for the same pattern?',
    );
  },
);
