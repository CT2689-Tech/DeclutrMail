import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, waitFor } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import {
  dehydrate,
  hydrate,
  QueryClient,
  QueryClientProvider,
  type DehydratedState,
} from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';

import { QueryHydrationBoundary, SERVER_STREAM_PLACEHOLDER } from '@/lib/query-hydration-boundary';

import { billingKeys } from './api/query-keys';
import { BillingInvoiceHistoryGate } from './billing-invoice-history-gate';
import { InvoiceHistory } from './invoice-history';

vi.mock('@/lib/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

const INVOICES = {
  invoices: [
    {
      id: 'txn_1',
      provider: 'paddle' as const,
      issuedAt: '2026-05-01T00:00:00.000Z',
      amount: '1900',
      currencyCode: 'USD',
      status: 'paid' as const,
      hostedUrl: 'https://billing.example/invoices/txn_1',
      documentAvailable: false,
    },
  ],
  unavailableProviders: [],
  omittedRows: 0,
  truncated: false,
};

afterEach(() => {
  document.body.innerHTML = '';
});

it('streams invoices on the billing page boundary instead of a nested suspense', () => {
  const page = readFileSync(resolve(process.cwd(), 'src/app/(app)/billing/page.tsx'), 'utf8');
  expect(page).toContain('streamPrefetch');
  expect(page).toContain('<BillingInvoiceHistoryGate />');
  expect(page).not.toContain('ServerBillingInvoices');
  expect(page).not.toContain('<Suspense');
});

it.each([null, { id: 'sub_1' }])(
  'keeps invoice loading markup when the stream fulfills before hydration with subscription %j',
  async (subscription) => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const source = new QueryClient();
    source.setQueryData(billingKeys.subscription(), { subscription });
    let resolve!: (value: typeof INVOICES) => void;
    void source.fetchQuery({
      queryKey: billingKeys.invoices(),
      queryFn: () =>
        new Promise<typeof INVOICES>((done) => {
          resolve = done;
        }),
    });
    const state = dehydrate(source, {
      shouldDehydrateQuery: (query) => query.state.status !== 'error',
    });
    const server = new QueryClient();
    const html = renderToString(
      <QueryClientProvider client={server}>
        <QueryHydrationBoundary state={state}>
          <BillingInvoiceHistoryGate />
        </QueryHydrationBoundary>
      </QueryClientProvider>,
    );
    expect(html).toContain('Loading invoices');

    resolve(INVOICES);
    await source.getQueryCache().find({ queryKey: billingKeys.invoices() })?.promise;
    const fulfilled = {
      status: 'fulfilled' as const,
      value: INVOICES,
      then(onFulfilled: (value: typeof INVOICES) => unknown) {
        onFulfilled(INVOICES);
      },
    } as unknown as Promise<unknown>;
    const clientState: DehydratedState = {
      ...state,
      queries: state.queries.map((query) =>
        query.queryKey.join('|') === billingKeys.invoices().join('|')
          ? { ...query, promise: fulfilled }
          : query,
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
            <QueryHydrationBoundary state={clientState}>
              <BillingInvoiceHistoryGate />
            </QueryHydrationBoundary>
          </QueryClientProvider>,
          { onRecoverableError: (error) => errors.push(error) },
        );
      });
      await waitFor(() => expect(container.textContent).toContain('View invoice'));
      expect(errors).toEqual([]);
    } finally {
      await act(async () => root?.unmount());
      source.clear();
      server.clear();
      client.clear();
    }
  },
);

it('hydrates a settled invoice list without a recoverable error', async () => {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    media: '',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

  const september = {
    ...INVOICES,
    invoices: [{ ...INVOICES.invoices[0]!, issuedAt: '2026-09-15T00:00:00.000Z' }],
  };
  const source = new QueryClient();
  source.setQueryData(billingKeys.subscription(), { subscription: { id: 'sub_1' } });
  source.setQueryData(billingKeys.invoices(), september);
  const state = dehydrate(source);
  const server = new QueryClient();
  const html = renderToString(
    <QueryClientProvider client={server}>
      <QueryHydrationBoundary state={state}>
        <BillingInvoiceHistoryGate />
      </QueryHydrationBoundary>
    </QueryClientProvider>,
  );
  expect(html).toContain('Sep 15, 2026');
  expect(html).toContain('$19.00');
  expect(html).not.toContain('Sept');
  expect(html).not.toContain('$ 19.00');

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
          <QueryHydrationBoundary state={state}>
            <BillingInvoiceHistoryGate />
          </QueryHydrationBoundary>
        </QueryClientProvider>,
        { onRecoverableError: (error) => errors.push(error) },
      );
    });
    expect(errors).toEqual([]);
    expect(container.textContent).toContain('Sep 15, 2026');
    expect(container.textContent).toContain('$19.00');
  } finally {
    await act(async () => root?.unmount());
    source.clear();
    server.clear();
    client.clear();
  }
});

const PROVIDER_UNAVAILABLE = {
  invoices: [],
  unavailableProviders: ['paddle' as const],
  omittedRows: 0,
  truncated: false,
};

function installMatchMedia(): void {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    media: '',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

it('keeps the streamed invoice skeleton when the fulfilled payload is already in the cache', async () => {
  // The server flushed "Loading invoices" while the stream was pending.
  // Next then delivers the resolved payload before the client hydrates, so
  // the cache can already hold the provider result. The first render still
  // has to be the skeleton.
  installMatchMedia();
  const source = new QueryClient();
  source.setQueryData(billingKeys.invoices(), PROVIDER_UNAVAILABLE);
  const state = dehydrate(source);
  const streamed = state.queries[0];
  if (!streamed) throw new Error('missing invoice query');
  streamed.meta = { [SERVER_STREAM_PLACEHOLDER]: true };
  const server = new QueryClient();
  hydrate(server, state);

  const html = renderToString(
    <QueryClientProvider client={server}>
      <InvoiceHistory enabled />
    </QueryClientProvider>,
  );
  expect(html).toContain('Loading invoices');
  expect(html).not.toContain('Try again');

  const client = new QueryClient();
  hydrate(client, state);
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
          <InvoiceHistory enabled />
        </QueryClientProvider>,
        { onRecoverableError: (error) => errors.push(error) },
      );
    });
    expect(errors).toEqual([]);
    expect(container.textContent).toContain('Try again');
    expect(container.textContent).toContain('return your invoices');
  } finally {
    await act(async () => root?.unmount());
    container.remove();
    source.clear();
    server.clear();
    client.clear();
  }
});

it('hydrates invoices deterministically when billing resolves immediately', async () => {
  // Near-zero latency hits three moments. Resolving before the snapshot
  // paints the list on both sides. Resolving after the HTML is flushed
  // keeps the skeleton. Resolving between those two — the read settles
  // and the server renders again before flush — used to paint the list
  // over the skeleton the client still hydrates (React #418, about 6%
  // of instant loads).
  installMatchMedia();
  const failures: string[] = [];
  const modes = ['before-snapshot', 'before-flush', 'after-html'] as const;
  for (let attempt = 0; attempt < 12; attempt++) {
    const mode = modes[attempt % modes.length]!;
    const failure = await hydrateInstantInvoices(mode);
    if (failure) failures.push(`${mode} #${attempt}: ${failure}`);
  }
  expect(failures).toEqual([]);
});

async function hydrateInstantInvoices(
  mode: 'before-snapshot' | 'before-flush' | 'after-html',
): Promise<string | null> {
  const source = new QueryClient();
  let resolve!: (value: typeof INVOICES) => void;
  const created = source.fetchQuery({
    queryKey: billingKeys.invoices(),
    queryFn: () =>
      new Promise<typeof INVOICES>((done) => {
        resolve = done;
      }),
  });
  void created.catch(() => undefined);
  if (mode === 'before-snapshot') {
    resolve(INVOICES);
    await created;
  }
  const state = dehydrate(source, {
    shouldDehydrateQuery: (query) =>
      query.state.status === 'success' ||
      (query.state.status === 'pending' && query.state.fetchStatus === 'fetching'),
  });
  const tree = (client: QueryClient, snapshot: DehydratedState) => (
    <QueryClientProvider client={client}>
      <QueryHydrationBoundary state={snapshot}>
        <InvoiceHistory enabled />
      </QueryHydrationBoundary>
    </QueryClientProvider>
  );
  const server = new QueryClient();
  let html = renderToString(tree(server, state));
  if (mode !== 'before-snapshot') {
    resolve(INVOICES);
    await created;
    await server.getQueryCache().find({ queryKey: billingKeys.invoices() })?.promise;
  }
  if (mode === 'before-flush') {
    if (server.getQueryData(billingKeys.invoices()) == null) {
      source.clear();
      server.clear();
      return 'server cache never received the instant invoice payload';
    }
    html = renderToString(tree(server, state));
  }
  if (mode === 'before-snapshot') {
    if (!html.includes('View invoice') || html.includes('Loading invoices')) {
      source.clear();
      server.clear();
      return `expected the settled list in the snapshot HTML, got ${html.slice(0, 180)}`;
    }
  } else if (!html.includes('Loading invoices') || html.includes('View invoice')) {
    source.clear();
    server.clear();
    return `expected the flushed skeleton, got ${html.slice(0, 180)}`;
  }

  const clientState: DehydratedState =
    mode === 'before-snapshot'
      ? state
      : {
          ...state,
          queries: state.queries.map((query) =>
            query.queryKey.join('|') === billingKeys.invoices().join('|')
              ? {
                  ...query,
                  promise: {
                    then(onFulfilled: (value: typeof INVOICES) => unknown) {
                      onFulfilled(INVOICES);
                    },
                  } as unknown as Promise<unknown>,
                }
              : query,
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
      root = hydrateRoot(container, tree(client, clientState), {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    if (errors.length > 0) return errors.map(String).join('\n');
    await waitFor(() => {
      if (!container.textContent?.includes('View invoice')) {
        throw new Error(container.textContent?.slice(0, 180) ?? '');
      }
    });
    return null;
  } finally {
    await act(async () => root?.unmount());
    container.remove();
    source.clear();
    server.clear();
    client.clear();
  }
}

it('renders a settled invoice result when the stream was not pending', () => {
  const source = new QueryClient();
  source.setQueryData(billingKeys.invoices(), PROVIDER_UNAVAILABLE);
  const client = new QueryClient();
  hydrate(client, dehydrate(source));
  const html = renderToString(
    <QueryClientProvider client={client}>
      <InvoiceHistory enabled />
    </QueryClientProvider>,
  );
  expect(html).toContain('Try again');
  expect(html).not.toContain('Loading invoices');
  source.clear();
  client.clear();
});
