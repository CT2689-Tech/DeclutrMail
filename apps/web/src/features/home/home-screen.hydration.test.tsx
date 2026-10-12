import { act } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Me } from '@/features/auth/api/me-contract';
import { homeKeys } from '@/features/home/api/query-keys';
import { syncStatusQueryKey } from '@/features/onboarding/api/use-sync-status';
import type { SyncStatus } from '@declutrmail/shared/contracts';

const authCell: { me: Me } = { me: meFor('syncing') };

vi.mock('@/features/auth/auth-provider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ me: authCell.me }) };
});
vi.mock('@/features/mailboxes/no-active-mailbox', () => ({
  NoActiveMailbox: () => <div data-testid="no-active-mailbox" />,
}));

import { HomeScreen } from './home-screen';

function meFor(readiness: Me['mailboxes'][number]['readiness']): Me {
  return {
    user: { id: 'u1', email: 'me@example.com', workspaceId: 'w1', timezone: null },
    mailboxes: [
      { id: 'mb-1', email: 'me@example.com', status: 'active', connectedAt: null, readiness },
    ],
    activeMailboxId: 'mb-1',
    tier: 'pro',
    cleanupRemaining: null,
  };
}

const EMPTY_SUMMARY = {
  window: 'all' as const,
  since: null,
  decidedSenders: 0,
  byVerb: { keep: 0, archive: 0, unsubscribe: 0, later: 0, delete: 0 },
  emailsByVerb: { keep: 0, archive: 0, unsubscribe: 0, later: 0, delete: 0 },
  emailsHandled: 0,
  undoCount: 0,
};

const SYNCING: SyncStatus = {
  readiness_status: 'syncing',
  current_stage: 'fetching_metadata',
  progress_pct: 10,
  is_ready_for_triage: false,
};

describe('Home scan hydration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('matches the server leave line, then shows the stage after mount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    const options = { defaultOptions: { queries: { retry: false, staleTime: Infinity } } };
    const server = new QueryClient(options);
    const browser = new QueryClient(options);
    await server.prefetchQuery({
      queryKey: homeKeys.summary(),
      queryFn: async () => EMPTY_SUMMARY,
    });
    await browser.prefetchQuery({
      queryKey: homeKeys.summary(),
      queryFn: async () => EMPTY_SUMMARY,
    });
    await browser.prefetchQuery({
      queryKey: syncStatusQueryKey('mb-1'),
      queryFn: async () => SYNCING,
    });
    const tree = (queryClient: QueryClient) => (
      <QueryClientProvider client={queryClient}>
        <HomeScreen />
      </QueryClientProvider>
    );
    const container = document.createElement('div');
    container.innerHTML = renderToString(tree(server));
    expect(container.textContent).toContain('You can close this tab and come back later.');
    expect(container.textContent).not.toContain('Collecting sender details.');

    const onRecoverableError = vi.fn();
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, tree(browser), { onRecoverableError });
      });
      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(container.textContent).toContain('Collecting sender details.');
      expect(container.textContent).not.toContain('You can close this tab and come back later.');
    } finally {
      root?.unmount();
    }
  });
});
