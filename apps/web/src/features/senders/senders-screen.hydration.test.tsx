import { act } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@declutrmail/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Avatar: () => <span aria-hidden="true" />,
}));
vi.mock('@/features/auth/auth-provider', () => {
  const auth = () => ({
    me: {
      user: { id: 'user', email: 'reader@example.com', workspaceId: 'workspace' },
      activeMailboxId: 'mailbox',
      tier: 'pro',
      cleanupRemaining: null,
      mailboxes: [
        { id: 'mailbox', email: 'reader@example.com', status: 'active', readiness: 'ready' },
      ],
    },
  });
  return {
    useAuth: auth,
    useOptionalAuth: auth,
    getActiveMailboxEmail: () => 'reader@example.com',
  };
});

import type { SenderListEnvelope, SenderSummaryDto } from '@/lib/api/senders';
import {
  DEFAULT_SENDERS_QUERY,
  sendersInfiniteQueryOptions,
  sendersSummaryQueryOptions,
} from './api/query-options';
import { SendersScreen } from './senders-screen';
import { useSendersStore } from './store';

const firstPage: SenderListEnvelope = {
  data: [
    {
      id: 'sender',
      displayName: 'Fixture sender',
      email: 'sender@example.com',
      domain: 'example.com',
      brandMark: false,
      gmailCategory: 'promotions',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-10-01T00:00:00.000Z',
      totalReceived: 12,
      monthlyVolume: 2,
      readRate: 0,
      volumeTrend: 'steady',
      wroteToCount: 0,
      unsubscribeMethod: 'none',
      lastReview: null,
      protectionFlags: { isProtected: false, protectionReason: null, protectionSetAt: null },
    },
  ],
  meta: {
    pagination: { nextCursor: null, hasMore: false, limit: 50 },
    query: { totalMatching: 1, globalMaxTotal: 12, asOf: '2026-10-01T00:00:00.000Z' },
  },
};
const summary: SenderSummaryDto = {
  totalSenders: 1,
  activeSenders: 1,
  last30dVolume: 2,
  noiseReducible: 0,
  protected: 0,
  needsReview: 0,
  byBucket: {
    one_time: 0,
    protect: 0,
    people: 0,
    needs_review: 0,
    quiet: 0,
    dormant: 0,
    bulk: 0,
    other: 1,
  },
  asOf: '2026-10-01T00:00:00.000Z',
  hasCompletedCleanup: false,
};

describe('Senders shared summary initial hydration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([false, true])(
    'matches SSR when shell summary completed before hydration: %s',
    async (summaryCompletesBeforeHydration) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => new Promise<Response>(() => undefined)),
      );
      useSendersStore.setState({ sort: 'total', direction: 'desc' });
      const options = { defaultOptions: { queries: { retry: false, staleTime: Infinity } } };
      const source = new QueryClient(options);
      await source.fetchInfiniteQuery(
        sendersInfiniteQueryOptions(DEFAULT_SENDERS_QUERY, async () => firstPage),
      );
      const state = dehydrate(source);
      const server = new QueryClient(options);
      const browser = new QueryClient(options);
      const tree = (client: QueryClient) => (
        <QueryClientProvider client={client}>
          <HydrationBoundary state={state}>
            <SendersScreen />
          </HydrationBoundary>
        </QueryClientProvider>
      );
      const container = document.createElement('div');
      container.innerHTML = renderToString(tree(server));
      expect(container.querySelector('[data-testid="first-cleanup-nudge"]')).toBeNull();
      if (summaryCompletesBeforeHydration) {
        await browser.fetchQuery(sendersSummaryQueryOptions({}, async () => ({ data: summary })));
      }
      const onRecoverableError = vi.fn();
      let root: Root | undefined;
      try {
        await act(async () => {
          root = hydrateRoot(container, tree(browser), { onRecoverableError });
          await new Promise((resolve) => setTimeout(resolve, 20));
        });
        expect(onRecoverableError).not.toHaveBeenCalled();
        if (summaryCompletesBeforeHydration) {
          expect(container.querySelector('[data-testid="first-cleanup-nudge"]')).not.toBeNull();
        }
      } finally {
        await act(async () => root?.unmount());
        source.clear();
        server.clear();
        browser.clear();
      }
    },
  );
});
