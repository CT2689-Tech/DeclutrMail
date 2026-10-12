import { act } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/client';

import { billingSubscriptionQueryOptions } from './api/query-options';
import { BillingScreen } from './billing-screen';

vi.mock('@/features/auth/auth-provider', () => {
  const auth = () => ({
    me: {
      user: { id: 'u', email: 'me@example.com', workspaceId: 'w' },
      activeMailboxId: 'mb-1',
      mailboxes: [],
      tier: 'free',
      cleanupRemaining: 3,
      cleanupResetsAt: null,
    },
  });
  return { useAuth: auth, useOptionalAuth: auth };
});

vi.mock('@/lib/posthog', () => ({ track: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  document.body.innerHTML = '';
});

it('keeps the billing placeholder through hydration when the read is already disabled', async () => {
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

  const server = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const html = renderToString(
    <QueryClientProvider client={server}>
      <BillingScreen />
    </QueryClientProvider>,
  );
  expect(html).toContain('Loading billing');
  expect(html).not.toContain('billing-disabled-notice');

  const disabled = new ApiError(
    503,
    { error: { code: 'BILLING_DISABLED', message: 'Billing is not available yet.' } },
    'disabled',
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await expect(
    client.fetchQuery(
      billingSubscriptionQueryOptions(async () => {
        throw disabled;
      }),
    ),
  ).rejects.toBe(disabled);

  const errors: unknown[] = [];
  const container = document.createElement('div');
  document.body.append(container);
  container.innerHTML = html;
  let root!: ReturnType<typeof hydrateRoot>;
  try {
    await act(async () => {
      root = hydrateRoot(
        container,
        <QueryClientProvider client={client}>
          <BillingScreen />
        </QueryClientProvider>,
        { onRecoverableError: (error) => errors.push(error) },
      );
    });
    expect(errors).toEqual([]);
    expect(container.querySelector('[data-testid="billing-disabled-notice"]')).not.toBeNull();
  } finally {
    await act(async () => root?.unmount());
    server.clear();
    client.clear();
  }
});
