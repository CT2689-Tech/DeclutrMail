import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { installFetchStub, jsonOk } from '@/test/fetch-stub';
import { createTestQueryClient } from '@/test/query-wrapper';
import { refreshAfterUndo } from '@/features/undo/refresh-after-undo';
import { useHomeAttention } from './use-home-attention';

function setup() {
  const client = createTestQueryClient();
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

describe('Home attention scope', () => {
  it('hides both old account counts until the selected account answers', async () => {
    const held: Array<() => void> = [];
    const scopes: Array<string | null> = [];
    installFetchStub([
      {
        method: 'GET',
        path: /\/api\/(screener\/count|snoozed)$/,
        respond: (req, url) => {
          const scope = req.headers.get('X-Active-Mailbox-Id');
          scopes.push(scope);
          const data = url.pathname.endsWith('/count')
            ? { pending: scope === 'a' ? 4 : 0 }
            : scope === 'a'
              ? [{ senderId: 'old-account', returnStatus: 'missed' }]
              : [];
          return scope === 'a'
            ? jsonOk({ data })
            : new Promise<Response>((resolve) => held.push(() => resolve(jsonOk({ data }))));
        },
      },
    ]);
    const hook = renderHook(({ id }) => useHomeAttention(id, true), {
      ...setup(),
      initialProps: { id: 'a' },
    });
    await waitFor(() => expect(hook.result.current.newSenders.data?.pending).toBe(4));
    expect(hook.result.current.later.data?.[0]?.senderId).toBe('old-account');
    hook.rerender({ id: 'b' });
    expect(hook.result.current.newSenders.data).toBeUndefined();
    expect(hook.result.current.later.data).toBeUndefined();
    await waitFor(() => expect(held).toHaveLength(2));
    await act(async () => held.forEach((release) => release()));
    await waitFor(() => expect(hook.result.current.newSenders.data?.pending).toBe(0));
    expect(hook.result.current.later.data).toEqual([]);
    expect(scopes.sort()).toEqual(['a', 'a', 'b', 'b']);
  });
  it('does not request first-review counts for an ineligible tier', async () => {
    const calls: string[] = [];
    installFetchStub([
      {
        method: 'GET',
        path: /\/api\/(screener\/count|snoozed)$/,
        respond: (_req, url) => {
          calls.push(url.pathname);
          return jsonOk({ data: [] });
        },
      },
    ]);
    const hook = renderHook(() => useHomeAttention('a', false), setup());
    await waitFor(() => expect(hook.result.current.later.isSuccess).toBe(true));
    expect(calls).toEqual(['/api/snoozed']);
    expect(hook.result.current.newSenders.data).toBeUndefined();
  });
  it('keeps a failed count unknown and does not retry a permanent error', async () => {
    let countReads = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/screener/count',
        respond: () => {
          countReads++;
          return new Response('{}', { status: 403 });
        },
      },
      { method: 'GET', path: '/api/snoozed', respond: () => jsonOk({ data: [] }) },
    ]);
    const hook = renderHook(() => useHomeAttention('a', true), setup());
    await waitFor(() => expect(hook.result.current.newSenders.isError).toBe(true));
    expect(hook.result.current.newSenders.data).toBeUndefined();
    expect(countReads).toBe(1);
  });
  it('does not make confirmed Undo wait for optional attention reads', async () => {
    let release!: () => void;
    installFetchStub([
      {
        method: 'GET',
        path: /\/api\/(screener\/count|snoozed)$/,
        respond: () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(jsonOk({ data: [] }));
          }),
      },
    ]);
    const options = setup();
    const hook = renderHook(() => useHomeAttention('a', false), options);
    await waitFor(() => expect(release).toBeTypeOf('function'));
    await Promise.race([
      refreshAfterUndo(options.client, 'a'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Undo waited for optional Home read')), 300),
      ),
    ]);
    expect(hook.result.current.later.isPending).toBe(true);
    await act(async () => release());
  });
});
