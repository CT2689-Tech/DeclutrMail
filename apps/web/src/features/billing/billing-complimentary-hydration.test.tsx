import { act } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { dehydrate, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BillingSubscription } from '@declutrmail/shared/contracts';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import { afterEach, expect, it, vi } from 'vitest';

import { priceLineFor } from '@/features/marketing/pricing/pricing-model';
import { QueryHydrationBoundary } from '@/lib/query-hydration-boundary';

import { billingSubscriptionQueryOptions } from './api/query-options';
import { billingKeys } from './api/query-keys';
import { BillingInvoiceHistoryGate } from './billing-invoice-history-gate';
import { BillingScreen } from './billing-screen';

vi.mock('@/features/auth/auth-provider', () => {
  const auth = () => ({
    me: {
      user: { id: 'u', email: 'me@example.com', workspaceId: 'w' },
      activeMailboxId: 'mb-1',
      mailboxes: [
        {
          id: 'mb-1',
          email: 'me@example.com',
          status: 'active',
          connectedAt: null,
          readiness: 'ready',
        },
      ],
      tier: 'pro',
      cleanupRemaining: null,
      cleanupResetsAt: null,
    },
  });
  return { useAuth: auth, useOptionalAuth: auth };
});

vi.mock('@/lib/posthog', () => ({ track: vi.fn(() => Promise.resolve()) }));

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    apiGet: vi.fn(async (path: string) => {
      if (path === '/api/billing/founding-remaining') return { data: { remaining: 10 } };
      return { data: { invoices: [], unavailableProviders: [], omittedRows: 0, truncated: false } };
    }),
  };
});

const COMPLIMENTARY_PRO: BillingSubscription = {
  checkoutSetupComplete: true,
  tier: 'pro',
  foundingMember: false,
  subscription: null,
  pendingCheckout: null,
  complimentary: { tier: 'pro', expiresAt: null },
};

const EMPTY_INVOICES = {
  invoices: [],
  unavailableProviders: [],
  omittedRows: 0,
  truncated: false,
};

function stubMatchMedia(): void {
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

function annualLine(tier: 'plus' | 'pro'): string {
  const line = priceLineFor(TIER_MANIFEST[tier], 'annual', 'paddle');
  if (!line) throw new Error(`missing annual price for ${tier}`);
  return `${line.amount}${line.per}`;
}

afterEach(() => {
  document.body.innerHTML = '';
});

it('hydrates a live Pro complimentary plan when the subscription read is already in flight', async () => {
  stubMatchMedia();

  const source = new QueryClient();
  source.setQueryData(billingKeys.subscription(), COMPLIMENTARY_PRO);
  source.setQueryData(billingKeys.invoices(), EMPTY_INVOICES);
  const state = dehydrate(source);

  const screen = (
    <BillingScreen
      pricingV2={false}
      initialProvider="paddle"
      country="US"
      invoiceHistory={<BillingInvoiceHistoryGate />}
    />
  );
  const server = new QueryClient();
  const html = renderToString(
    <QueryClientProvider client={server}>
      <QueryHydrationBoundary state={state}>{screen}</QueryHydrationBoundary>
    </QueryClientProvider>,
  );

  expect(html).toContain('Pro is complimentary on this account');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('>Annual');
  expect(html).toContain(annualLine('plus'));
  expect(html).toContain(annualLine('pro'));
  expect(html).not.toContain('Loading billing');

  // The app shell can start this read while billing/loading.tsx is still
  // the streamed fallback. The page then hydrates against a pending query
  // instead of the server snapshot.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  void client
    .fetchQuery(
      billingSubscriptionQueryOptions(() => new Promise<BillingSubscription>(() => undefined)),
    )
    .catch(() => undefined);
  expect(client.getQueryState(billingKeys.subscription())?.status).toBe('pending');
  expect(client.getQueryData(billingKeys.subscription())).toBeUndefined();

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
          <QueryHydrationBoundary state={state}>{screen}</QueryHydrationBoundary>
        </QueryClientProvider>,
        {
          onRecoverableError: (error) => {
            errors.push(error);
          },
        },
      );
    });
    expect(errors.map((error) => (error instanceof Error ? error.message : String(error)))).toEqual(
      [],
    );
    expect(container.querySelector('[data-testid="complimentary-note"]')?.textContent).toContain(
      'Pro is complimentary on this account',
    );
    const annual = container.querySelector('[data-testid="cycle-toggle"] [aria-pressed="true"]');
    expect(annual?.textContent).toContain('Annual');
    expect(container.textContent).toContain(annualLine('plus'));
    expect(container.textContent).toContain(annualLine('pro'));
    expect(container.textContent).not.toContain('Loading billing');
  } finally {
    await act(async () => root?.unmount());
    source.clear();
    server.clear();
    client.clear();
  }
});
