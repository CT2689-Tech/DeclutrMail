import { QueryClient } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => ({ cookie: 'dm_access=synthetic' }));
vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ cookie: request.cookie }) }));
vi.mock('@/features/marketing/pricing/load-pricing-flags', () => ({
  loadPricingFlags: async () => ({ pricingV2: true, indiaCheckoutOpen: false }),
  indiaCheckoutReady: () => false,
}));

import BillingPage from '@/app/(app)/billing/page';
import { billingKeys } from './api/query-keys';

const history = {
  invoices: [
    {
      id: 'txn_paid_pass',
      provider: 'paddle',
      issuedAt: '2026-05-01T00:00:00.000Z',
      amount: '1900',
      currencyCode: 'USD',
      status: 'paid',
      hostedUrl: null,
      documentAvailable: true,
    },
  ],
  unavailableProviders: [],
  truncated: false,
  omittedRows: 0,
};

afterEach(() => {
  request.cookie = 'dm_access=synthetic';
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each(['free', 'plus', 'pro'])(
  'server-loads actual payment history for %s without a current subscription',
  async (tier) => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/billing/subscription')
        return Response.json({
          data: {
            tier,
            complimentary: null,
            subscription: null,
            pendingCheckout: null,
            foundingMember: false,
          },
        });
      if (path === '/api/billing/invoices') return Response.json({ data: history });
      throw new Error(`Unexpected test request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const page = await BillingPage({ searchParams: Promise.resolve({}) });
    const client = new QueryClient();
    try {
      await Promise.all([...page.props.prefetch(client), ...page.props.streamPrefetch(client)]);
      expect(client.getQueryData(billingKeys.subscription())).toMatchObject({
        tier,
        subscription: null,
      });
      expect(fetchSpy.mock.calls.map(([input]) => new URL(String(input)).pathname)).toContain(
        '/api/billing/invoices',
      );
      expect(client.getQueryData(billingKeys.invoices())).toEqual(history);
    } finally {
      client.clear();
    }
  },
);

it('preserves the history endpoint error when billing is unavailable', async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
  const fetchSpy = vi.fn(async () =>
    Response.json({ error: { code: 'BILLING_DISABLED' } }, { status: 503 }),
  );
  vi.stubGlobal('fetch', fetchSpy);
  const page = await BillingPage({ searchParams: Promise.resolve({}) });
  const client = new QueryClient();
  try {
    const results = await Promise.allSettled(page.props.streamPrefetch(client));
    expect(results[0]?.status).toBe('rejected');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  } finally {
    client.clear();
  }
});

it('does not start a history read without an authenticated access cookie', async () => {
  request.cookie = 'dm_refresh=synthetic';
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  const page = await BillingPage({ searchParams: Promise.resolve({}) });
  const client = new QueryClient();
  try {
    expect(page.props.streamPrefetch(client)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    client.clear();
  }
});

it('loads history even when current plan details fail', async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) =>
      new URL(String(input)).pathname === '/api/billing/invoices'
        ? Response.json({ data: history })
        : Response.json({ error: { code: 'INTERNAL_ERROR' } }, { status: 500 }),
    ),
  );
  const page = await BillingPage({ searchParams: Promise.resolve({}) });
  const client = new QueryClient();
  try {
    const plan = await Promise.allSettled(page.props.prefetch(client));
    expect(plan[0]?.status).toBe('rejected');
    await Promise.all(page.props.streamPrefetch(client));
    expect(client.getQueryData(billingKeys.invoices())).toEqual(history);
  } finally {
    client.clear();
  }
});

it('skips server history in the isolated billing-disabled simulation', async () => {
  vi.stubEnv('E2E_ISOLATED', '1');
  request.cookie += '; dm_e2e_billing_dark=1';
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  const page = await BillingPage({ searchParams: Promise.resolve({}) });
  const client = new QueryClient();
  try {
    expect(page.props.streamPrefetch(client)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    client.clear();
  }
});
