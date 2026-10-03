import { act, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import {
  dehydrate,
  QueryClient,
  QueryClientProvider,
  useQuery,
  type DehydratedState,
} from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { QueryHydrationBoundary as HydrationBoundary } from './query-hydration-boundary';

it.each(['before-client', 'after-client'] as const)(
  'keeps pending server markup when the stream fulfills %s hydration',
  async (timing) => {
    const reader = vi.fn();
    function Probe() {
      const query = useQuery({ queryKey: ['optional-review'], queryFn: reader, enabled: false });
      return <p>{query.isPending ? 'Review loading' : `Review ready: ${query.data}`}</p>;
    }
    const source = new QueryClient();
    let resolve!: (value: number) => void;
    void source.fetchQuery({
      queryKey: ['optional-review'],
      queryFn: () =>
        new Promise<number>((done) => {
          resolve = done;
        }),
    });
    const state = dehydrate(source, { shouldDehydrateQuery: () => true });
    const server = new QueryClient();
    const html = renderToString(
      <QueryClientProvider client={server}>
        <HydrationBoundary state={state}>
          <Probe />
        </HydrationBoundary>
      </QueryClientProvider>,
    );
    expect(html).toBe('<p>Review loading</p>');
    if (timing === 'before-client') {
      resolve(0);
      await source.getQueryCache().find({ queryKey: ['optional-review'] })?.promise;
    }
    // Flight thenables can invoke callbacks synchronously once fulfilled.
    const fulfilled = {
      then: (onFulfilled: (value: number) => unknown) => Promise.resolve(onFulfilled(0)),
    } as unknown as Promise<unknown>;
    const clientState: DehydratedState = {
      ...state,
      queries: state.queries.map((query) =>
        timing === 'before-client' ? { ...query, promise: fulfilled } : query,
      ),
    };
    const client = new QueryClient();
    const container = document.createElement('div');
    document.body.append(container);
    container.innerHTML = html;
    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    try {
      await act(async () => {
        root = hydrateRoot(
          container,
          <QueryClientProvider client={client}>
            <HydrationBoundary state={clientState}>
              <Probe />
            </HydrationBoundary>
          </QueryClientProvider>,
          { onRecoverableError: (error) => errors.push(error) },
        );
      });
      if (timing === 'after-client') {
        expect(container.textContent).toBe('Review loading');
        await act(async () => resolve(0));
      }
      await waitFor(() => expect(container.textContent).toBe('Review ready: 0'));
      expect(errors).toEqual([]);
      expect(reader).not.toHaveBeenCalled();
    } finally {
      await act(async () => root?.unmount());
      container.remove();
      source.clear();
      server.clear();
      client.clear();
    }
  },
);

it('preserves settled server data and newer existing client data', async () => {
  const source = new QueryClient();
  await source.fetchQuery({ queryKey: ['settled'], queryFn: async () => 7 });
  const state = dehydrate(source);
  const client = new QueryClient();
  client.setQueryData(['settled'], 9, { updatedAt: Date.now() + 1000 });
  const reader = vi.fn();
  function Probe() {
    const query = useQuery({ queryKey: ['settled'], queryFn: reader, enabled: false });
    return <p>{String(query.data)}</p>;
  }
  expect(
    renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <HydrationBoundary state={state}>
          <Probe />
        </HydrationBoundary>
      </QueryClientProvider>,
    ),
  ).toBe('<p>7</p>');
  expect(
    renderToString(
      <QueryClientProvider client={client}>
        <HydrationBoundary state={state}>
          <Probe />
        </HydrationBoundary>
      </QueryClientProvider>,
    ),
  ).toBe('<p>9</p>');
  expect(reader).not.toHaveBeenCalled();
  source.clear();
  client.clear();
});

it('adopts a rejected Flight stream without markup recovery or an extra browser read', async () => {
  const source = new QueryClient();
  let resolve!: (value: number) => void;
  void source.fetchQuery({
    queryKey: ['rejected-review'],
    queryFn: () =>
      new Promise<number>((done) => {
        resolve = done;
      }),
  });
  const state = dehydrate(source, { shouldDehydrateQuery: () => true });
  const reader = vi.fn();
  function Probe() {
    const query = useQuery({
      queryKey: ['rejected-review'],
      queryFn: reader,
      enabled: false,
      retry: false,
    });
    return (
      <p>
        {query.isPending ? 'Review loading' : query.isError ? 'Review unavailable' : 'Review ready'}
      </p>
    );
  }
  const server = new QueryClient();
  const html = renderToString(
    <QueryClientProvider client={server}>
      <HydrationBoundary state={state}>
        <Probe />
      </HydrationBoundary>
    </QueryClientProvider>,
  );
  const rejected = {
    then: (_fulfilled: unknown, onRejected: (error: Error) => unknown) =>
      Promise.resolve(onRejected(new Error('Synthetic stream recovery'))),
  } as unknown as Promise<unknown>;
  const clientState = {
    ...state,
    queries: state.queries.map((query) => ({ ...query, promise: rejected })),
  };
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.append(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const errors: unknown[] = [];
  let root!: ReturnType<typeof hydrateRoot>;
  try {
    await act(async () => {
      root = hydrateRoot(
        container,
        <QueryClientProvider client={client}>
          <HydrationBoundary state={clientState}>
            <Probe />
          </HydrationBoundary>
        </QueryClientProvider>,
        { onRecoverableError: (error) => errors.push(error) },
      );
    });
    await waitFor(() => expect(container.textContent).toBe('Review unavailable'));
    expect(errors).toEqual([]);
    expect(reader).not.toHaveBeenCalled();
  } finally {
    resolve(0);
    await act(async () => root?.unmount());
    container.remove();
    source.clear();
    server.clear();
    client.clear();
  }
});
