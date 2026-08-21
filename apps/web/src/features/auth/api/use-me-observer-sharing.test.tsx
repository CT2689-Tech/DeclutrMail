/**
 * Regression: `useUserTimeZone()` must not disarm the `me` query.
 *
 * `useMe()` and `useUserTimeZone()` observe the SAME query key. In
 * TanStack Query a query is one shared object and every observer writes
 * its whole options object onto it (`QueryObserver.setOptions` →
 * `query.setOptions`), so the last hook to render wins. `useUserTimeZone`
 * lives below `AuthProvider` in the tree, so it always renders last.
 *
 * When its `queryFn` was `skipToken`, that stamped `skipToken` onto the
 * shared query. `Query.fetch()`'s self-heal only fires on a FALSY
 * `queryFn`, and `skipToken` is truthy — so the next keyless refetch
 * (`invalidateQueries` → `query.fetch(undefined, …)`, which every action
 * mutation does to re-read `cleanupRemaining`) rejected with
 * `Missing queryFn: '["auth","me"]'`. `useMe().error` then took
 * AuthProvider to its "Auth check failed." branch and the whole app died
 * until a hard reload (prod, 2026-08-21, after deleting one sender).
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
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

import { ME_QUERY_KEY, useMe, useUserTimeZone } from './use-me';

/** Match the machine zone so `useMe`'s timezone-healing effect stays a no-op. */
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const ME = {
  user: { id: 'u1', email: 'u@example.com', workspaceId: 'w1', timezone: ZONE },
  mailboxes: [],
  activeMailboxId: null,
  tier: 'free' as const,
  cleanupRemaining: 42,
};

/** Mirrors the real tree: AuthProvider owns `useMe`, chrome below reads the zone. */
function Tree() {
  const me = useMe();
  return (
    <div>
      <span data-testid="quota">{me.data ? String(me.data.cleanupRemaining) : 'none'}</span>
      <span data-testid="error">{me.error ? me.error.message : ''}</span>
      <ZoneLabel />
    </div>
  );
}

/**
 * `observer.setOptions` runs in a `useEffect` on EVERY render, so the query's
 * resting options belong to whichever consumer re-rendered last. `AuthProvider`
 * re-renders only when `me` changes; a screen below it re-renders constantly.
 * `bump` stands in for that ordinary local re-render.
 */
let bumpZone: () => void = () => {};
function ZoneLabel() {
  const [, setTick] = useState(0);
  bumpZone = () => setTick((n) => n + 1);
  return <span data-testid="zone">{useUserTimeZone()}</span>;
}

describe('me query shared by useMe + useUserTimeZone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('survives an invalidateQueries refetch (the action-mutation path)', async () => {
    apiGet.mockResolvedValue({ data: ME });
    apiPatch.mockResolvedValue({ data: {} });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <Tree />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('quota').textContent).toBe('42'));
    expect(screen.getByTestId('zone').textContent).toBe(ZONE);

    // An ordinary re-render of the screen below AuthProvider.
    act(() => bumpZone());

    // What `useEnqueueCompositeAction().onSuccess` does after a delete.
    apiGet.mockResolvedValue({ data: { ...ME, cleanupRemaining: 41 } });
    await client.invalidateQueries({ queryKey: ME_QUERY_KEY });

    await waitFor(() => expect(screen.getByTestId('quota').textContent).toBe('41'));
    expect(screen.getByTestId('error').textContent).toBe('');
  });

  it('never fetches on its own when useMe is absent', async () => {
    apiGet.mockResolvedValue({ data: ME });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <ZoneLabel />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('zone').textContent).toBe('UTC');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(apiGet).not.toHaveBeenCalled();
  });
});
