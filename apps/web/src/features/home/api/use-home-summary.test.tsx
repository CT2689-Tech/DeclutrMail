import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { invalidateAfterDecision } from '@/features/triage/api/invalidate';
import { invalidateAfterUndo } from '@/features/triage/triage-undo-tray';
import { reconcileAction } from '@/lib/api/reconcile-action';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';

import { useHomeSummary } from './use-home-summary';

afterEach(() => resetFetchStub());

describe('Home totals after completed decisions', () => {
  it.each([
    [
      'a label action completes',
      (client: QueryClient) => reconcileAction(client, { status: 'done' }),
    ],
    ['Keep commits', invalidateAfterDecision],
    ['Undo completes', invalidateAfterUndo],
  ])('refreshes a mounted, fresh summary when %s', async (_name, complete) => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false },
      },
    });
    let handled = 10;
    let requests = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity/summary',
        respond: () => {
          requests += 1;
          return jsonOk({
            data: { since: null, decidedSenders: handled, emailsByVerb: { archive: handled } },
          });
        },
      },
    ]);
    const { result, unmount } = renderHook(() => useHomeSummary({ enabled: true }), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    try {
      await waitFor(() => expect(result.current.data?.emailsByVerb?.archive).toBe(10));
      handled = 4;
      await act(async () => {
        await complete(client);
      });
      await waitFor(() => expect(result.current.data?.emailsByVerb?.archive).toBe(4));
      expect(requests).toBe(2);
    } finally {
      unmount();
      client.clear();
    }
  });
});
