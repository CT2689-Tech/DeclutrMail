import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { installFetchStub, jsonOk } from '@/test/fetch-stub';
import { createTestQueryClient } from '@/test/query-wrapper';
import { refreshAfterUndo } from '@/features/undo/refresh-after-undo';
import { homeKeys } from './query-keys';
import { useHomeSenderPreview } from './use-home-sender-preview';

const sender = (id: string, name = id) => ({
  id,
  displayName: name,
  domain: `${id}.synthetic.test`,
  brandMark: false,
  protectionFlags: { isProtected: false },
});
function setup() {
  const client = createTestQueryClient();
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

describe('Home suggested sender identities', () => {
  it('reads at most three exact unique IDs with mailbox scope and preserves recommendation order', async () => {
    const reads: Array<{ id: string; mailbox: string | null }> = [];
    installFetchStub([
      {
        method: 'GET',
        path: /\/api\/senders\/[^/]+$/,
        respond: (req, url) => {
          const id = url.pathname.split('/').at(-1)!;
          reads.push({ id, mailbox: req.headers.get('X-Active-Mailbox-Id') });
          return jsonOk({ data: sender(id) });
        },
      },
    ]);
    const { result } = renderHook(
      () => useHomeSenderPreview('mb-a', ['c', 'a', 'c', 'b', 'd'], true),
      setup(),
    );
    await waitFor(() => expect(result.current.map((row) => row.id)).toEqual(['c', 'a', 'b']));
    expect(reads).toEqual(['c', 'a', 'b'].map((id) => ({ id, mailbox: 'mb-a' })));
  });

  it('keeps valid identities when another is missing, Protected or mismatched', async () => {
    let missingReads = 0;
    installFetchStub([
      {
        method: 'GET',
        path: /\/api\/senders\/[^/]+$/,
        respond: (_req, url) => {
          const id = url.pathname.split('/').at(-1)!;
          if (id === 'gone') {
            missingReads++;
            return new Response(JSON.stringify({ error: { code: 'SENDER_NOT_FOUND' } }), {
              status: 404,
            });
          }
          return jsonOk({
            data:
              id === 'protected'
                ? { ...sender(id), protectionFlags: { isProtected: true } }
                : id === 'wrong'
                  ? sender('other')
                  : sender(id),
          });
        },
      },
    ]);
    const { wrapper, client } = setup();
    const { result, rerender } = renderHook(({ ids }) => useHomeSenderPreview('mb-a', ids, true), {
      wrapper,
      initialProps: { ids: ['a', 'gone', 'protected'] },
    });
    await waitFor(() =>
      expect(client.getQueryState(homeKeys.senderPreview('mb-a', 'gone'))?.status).toBe('error'),
    );
    expect(result.current.map((row) => row.id)).toEqual(['a']);
    expect(missingReads).toBe(1);
    rerender({ ids: ['wrong'] });
    await waitFor(() =>
      expect(client.getQueryState(homeKeys.senderPreview('mb-a', 'wrong'))?.status).toBe('success'),
    );
    expect(result.current).toEqual([]);
  });

  it('drops previous-account identities while a new account read is pending, including late responses', async () => {
    let release!: (response: Response) => void;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders/a',
        respond: (req) =>
          req.headers.get('X-Active-Mailbox-Id') === 'mb-a'
            ? new Promise<Response>((resolve) => {
                release = resolve;
              })
            : jsonOk({ data: sender('a', 'Mailbox B sender') }),
      },
    ]);
    const { result, rerender } = renderHook(
      ({ mailbox }) => useHomeSenderPreview(mailbox, ['a'], true),
      { ...setup(), initialProps: { mailbox: 'mb-a' } },
    );
    rerender({ mailbox: 'mb-b' });
    await waitFor(() => expect(result.current[0]?.name).toBe('Mailbox B sender'));
    await act(async () => release(jsonOk({ data: sender('a', 'Mailbox A sender') })));
    expect(result.current.map((row) => row.name)).toEqual(['Mailbox B sender']);
  });

  it('does not make confirmed Undo wait for a stalled optional name read', async () => {
    const releases: Array<(response: Response) => void> = [];
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders/a',
        respond: () => new Promise<Response>((resolve) => releases.push(resolve)),
      },
    ]);
    const { client, wrapper } = setup();
    renderHook(() => useHomeSenderPreview('mb-a', ['a'], true), { wrapper });
    let complete = false;
    const refresh = refreshAfterUndo(client, 'mb-a').then(() => {
      complete = true;
    });
    try {
      await waitFor(() => expect(complete).toBe(true), { timeout: 300 });
      expect(client.isFetching()).toBe(1);
    } finally {
      await act(async () => {
        for (const release of releases) release(jsonOk({ data: sender('a') }));
        await refresh;
      });
    }
  });

  it('never paints an old suggestion while its replacement is loading', async () => {
    let release!: (response: Response) => void;
    installFetchStub([
      {
        method: 'GET',
        path: /\/api\/senders\/[^/]+$/,
        respond: (_req, url) =>
          url.pathname.endsWith('/a')
            ? jsonOk({ data: sender('a') })
            : new Promise<Response>((resolve) => {
                release = resolve;
              }),
      },
    ]);
    const { result, rerender } = renderHook(({ ids }) => useHomeSenderPreview('mb-a', ids, true), {
      ...setup(),
      initialProps: { ids: ['a'] },
    });
    await waitFor(() => expect(result.current[0]?.id).toBe('a'));
    rerender({ ids: ['b'] });
    expect(result.current).toEqual([]);
    await act(async () => release(jsonOk({ data: sender('b') })));
    await waitFor(() => expect(result.current[0]?.id).toBe('b'));
  });

  it.each([
    { mailbox: null, enabled: true },
    { mailbox: 'mb-a', enabled: false },
  ])('does not read without an eligible active mailbox: %o', (props) => {
    let calls = 0;
    installFetchStub([
      {
        method: 'GET',
        path: /\/api\/senders\//,
        respond: () => {
          calls++;
          return jsonOk({ data: sender('a') });
        },
      },
    ]);
    const { result } = renderHook(
      () => useHomeSenderPreview(props.mailbox, ['a'], props.enabled),
      setup(),
    );
    expect(result.current).toEqual([]);
    expect(calls).toBe(0);
  });
});
