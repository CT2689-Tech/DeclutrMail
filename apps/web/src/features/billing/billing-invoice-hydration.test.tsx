import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, waitFor } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import {
  dehydrate,
  QueryClient,
  QueryClientProvider,
  type DehydratedState,
} from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';

import { QueryHydrationBoundary } from '@/lib/query-hydration-boundary';

import { billingKeys } from './api/query-keys';
import { BillingInvoiceHistoryGate } from './billing-invoice-history-gate';

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

it('keeps the invoice loading markup when the stream fulfills before hydration', async () => {
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
  source.setQueryData(billingKeys.subscription(), { subscription: { id: 'sub_1' } });
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
});

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
