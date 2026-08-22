/**
 * AuthProvider's failure behaviour.
 *
 * These are the cases that decide whether a bad minute for `/api/auth/me`
 * is a blip or an outage. On 2026-08-21 it was an outage: the provider read
 * `if (me.error || !me.data)`, so the instant ANY background re-read failed
 * it replaced a fully working app with a dead-end "Auth check failed." page
 * showing a raw TanStack internal. Deleting one sender was enough to trigger
 * it, and nothing recovered without a hard reload.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiClientModule from '@/lib/api/client';

const apiGet = vi.fn();
const apiPatch = vi.fn();
vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof ApiClientModule>('@/lib/api/client');
  return {
    ...actual,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPatch: (...a: unknown[]) => apiPatch(...a),
  };
});

import { ApiError } from '@/lib/api/client';
import { AuthProvider } from './auth-provider';
import { ME_QUERY_KEY } from './api/use-me';

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const ME = {
  user: { id: 'u1', email: 'u@example.com', workspaceId: 'w1', timezone: ZONE },
  mailboxes: [],
  activeMailboxId: null,
  tier: 'free' as const,
  cleanupRemaining: 42,
};

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <main data-testid="app">the app</main>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { client, ...utils };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiPatch.mockResolvedValue({ data: {} });
});

describe('AuthProvider', () => {
  it('keeps the app mounted when a background re-read fails', async () => {
    apiGet.mockResolvedValue({ data: ME });
    const { client } = mount();
    await waitFor(() => expect(screen.getByTestId('app')).toBeTruthy());

    // The 2026-08-21 sequence: an action mutation invalidates `me` to
    // re-read the cleanup quota, and that refetch rejects.
    apiGet.mockRejectedValue(new Error(`Missing queryFn: '["auth","me"]'`));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ME_QUERY_KEY }).catch(() => undefined);
    });

    expect(client.getQueryState(ME_QUERY_KEY)?.error).toBeTruthy();
    expect(screen.getByTestId('app')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers a working retry when there is no session at all', async () => {
    apiGet.mockRejectedValue(new ApiError(503, {}, 'GET /api/auth/me failed: 503'));
    mount();

    // `meQueryOptions` retries twice with backoff before it gives up, so the
    // failure surface is ~3s away — that patience is the point of the retry.
    const retry = await screen.findByRole('button', { name: /try again/i }, { timeout: 8000 });
    expect(screen.queryByTestId('app')).toBeNull();

    apiGet.mockResolvedValue({ data: ME });
    await act(async () => {
      retry.click();
    });
    await waitFor(() => expect(screen.getByTestId('app')).toBeTruthy());
  });

  it('never renders the raw error text', async () => {
    apiGet.mockRejectedValue(new Error(`Missing queryFn: '["auth","me"]'`));
    mount();

    await screen.findByRole('alert', {}, { timeout: 8000 });
    expect(document.body.textContent).not.toContain('Missing queryFn');
    expect(document.body.textContent).not.toContain('Auth check failed');
  });

  it('shows the skeleton, not a failure, while the first read is in flight', () => {
    apiGet.mockReturnValue(new Promise(() => {}));
    mount();

    expect(screen.getByTestId('auth-skeleton')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sends a revoked session to consent even though a session is cached', async () => {
    apiGet.mockResolvedValue({ data: ME });
    const { client } = mount();
    await waitFor(() => expect(screen.getByTestId('app')).toBeTruthy());

    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign },
    });

    apiGet.mockRejectedValue(new ApiError(401, {}, 'GET /api/auth/me failed: 401'));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ME_QUERY_KEY }).catch(() => undefined);
    });

    await waitFor(() => expect(assign).toHaveBeenCalledOnce());
    expect(String(assign.mock.calls[0]?.[0])).toContain('/api/auth/google/start');
    expect(screen.queryByTestId('app')).toBeNull();
  });
});
