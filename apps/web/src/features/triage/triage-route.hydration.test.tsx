import { act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/billing/tier-gate', () => ({
  TierGate: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@declutrmail/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Avatar: () => <span aria-hidden="true" />,
}));
vi.mock('@/features/auth/auth-provider', async (importOriginal) => {
  const auth = {
    me: {
      user: { id: 'user', email: 'reader@example.com', workspaceId: 'workspace', timezone: null },
      activeMailboxId: 'mailbox',
      tier: 'pro',
      cleanupRemaining: null,
      mailboxes: [{ id: 'mailbox', email: 'reader@example.com', readiness: 'ready' }],
    },
  };
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useAuth: () => auth,
    useOptionalAuth: () => auth,
  };
});

import { TriageRoute } from '@/app/(app)/triage/triage-route';
import { undoKeys } from '@/features/undo/query-keys';
import type { InFlightActionGroup } from '@/lib/api/actions';
import { triageBootstrapQueryOptions } from './api/query-options';
import { TRIAGE_QUEUE, TRIAGE_SESSION_STATS } from './fixtures';
import { resetTriageStore } from './store';

describe('Triage initial document hydration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([false, true])(
    'preserves the header when a running job arrives before hydration: %s',
    async (jobCompletesBeforeHydration) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => new Promise<Response>(() => undefined)),
      );
      resetTriageStore();
      // Daily SQL orders Archive first, then confidence/key. Expiry is
      // independent: a stale Archive can precede three fresh Archive rows.
      // The API emits stale=true for expired rows without excluding them.
      const archives = TRIAGE_QUEUE.filter((row) => row.verdict === 'archive').sort(
        (a, b) => b.confidence - a.confidence || a.senderKey.localeCompare(b.senderKey),
      );
      const rows = [{ ...archives[0]!, stale: true }, ...archives.slice(1, 4)];
      const options = { defaultOptions: { queries: { retry: false, staleTime: Infinity } } };
      const source = new QueryClient(options);
      await source.fetchQuery(
        triageBootstrapQueryOptions(async () => ({
          queue: rows,
          stats: TRIAGE_SESSION_STATS,
          todaySummary: {
            receivedToday: 0,
            sendersToday: 0,
            handledAutomatically: 0,
            queuedDecisions: rows.length,
            noiseSenderCount: 3,
            noiseReductionPct: null,
          },
        })),
      );
      const state = dehydrate(source);
      const server = new QueryClient(options);
      const browser = new QueryClient(options);
      const tree = (client: QueryClient) => (
        <QueryClientProvider client={client}>
          <HydrationBoundary state={state}>
            <TriageRoute />
          </HydrationBoundary>
        </QueryClientProvider>
      );
      const container = document.createElement('div');
      container.innerHTML = renderToString(tree(server));
      expect(container.textContent).toContain('4 in queue');
      expect(container.textContent).not.toContain('Reviewing');
      if (jobCompletesBeforeHydration) {
        const group: InFlightActionGroup = {
          groupId: 'running-group',
          verb: 'archive',
          mixedVerbs: false,
          running: true,
          total: 1,
          done: 0,
          failed: 0,
          senderCount: 1,
          leadSenderName: null,
          startedAt: '2026-10-03T00:00:00.000Z',
          senderIds: [rows[1]!.senderId],
        };
        await browser.fetchQuery({
          queryKey: undoKeys.inFlight('mailbox'),
          queryFn: async () => [group],
        });
      }
      const onRecoverableError = vi.fn();
      let root: Root | undefined;
      try {
        await act(async () => {
          root = hydrateRoot(container, tree(browser), { onRecoverableError });
          await new Promise((resolve) => setTimeout(resolve, 20));
        });
        expect(onRecoverableError).not.toHaveBeenCalled();
        expect(container.textContent).toContain(
          `Reviewing ${jobCompletesBeforeHydration ? 1 : 2} of 4`,
        );
      } finally {
        await act(async () => root?.unmount());
        source.clear();
        server.clear();
        browser.clear();
      }
    },
  );
});
