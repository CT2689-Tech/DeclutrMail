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
  it('never shows the previous mailbox totals while the selected mailbox is loading', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let release!: () => void;
    const scopes: Array<string | null> = [];
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity/summary',
        respond: (req) => {
          const mailbox = req.headers.get('X-Active-Mailbox-Id');
          scopes.push(mailbox);
          const data = {
            since: null,
            decidedSenders: 1,
            emailsByVerb: { archive: mailbox === 'b' ? 4 : 10 },
          };
          return mailbox === 'b'
            ? new Promise<Response>((resolve) => {
                release = () => resolve(jsonOk({ data }));
              })
            : jsonOk({ data });
        },
      },
    ]);
    const hook = renderHook(({ mailboxId }) => useHomeSummary({ enabled: true, mailboxId }), {
      initialProps: { mailboxId: 'a' },
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(hook.result.current.data?.emailsByVerb?.archive).toBe(10));
    hook.rerender({ mailboxId: 'b' });
    expect(hook.result.current.data).toBeUndefined();
    await waitFor(() => expect(release).toBeTypeOf('function'));
    await act(async () => release());
    await waitFor(() => expect(hook.result.current.data?.emailsByVerb?.archive).toBe(4));
    expect(scopes).toEqual(['a', 'b']);
    hook.unmount();
    client.clear();
  });
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
    const { result, unmount } = renderHook(
      () => useHomeSummary({ enabled: true, mailboxId: 'a' }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );
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
