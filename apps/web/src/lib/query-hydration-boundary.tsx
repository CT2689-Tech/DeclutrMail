'use client';

import { useMemo, type ReactNode } from 'react';
import { HydrationBoundary, useQueryClient, type DehydratedState } from '@tanstack/react-query';

import { useHydrated } from './use-hydrated';

/**
 * Set on a query dehydrated while its read was still in flight. Next can
 * hand the client the resolved value before hydration, and a synchronous
 * Flight `then` promotes that query before children render. Consumers that
 * painted a loading placeholder on the server keep it for the hydration
 * render, then reveal the resolved value after mount.
 */
export const SERVER_STREAM_PLACEHOLDER = 'serverPlaceholder';

/** Preserve the pending server snapshot on the first client render. */
export function QueryHydrationBoundary({
  state,
  children,
}: {
  state: DehydratedState;
  children: ReactNode;
}) {
  const client = useQueryClient();
  // Server render and the hydration render. A streamed read can settle in
  // that window; the replay then paints the resolved tree from the cache
  // while the client still hydrates the pending snapshot.
  const serverPass = !useHydrated();
  const initialState = useMemo(() => {
    const queries = state.queries.map((query) => {
      if (query.state.status !== 'pending' || !query.promise) return query;
      // Fulfilled Flight thenables invoke .then synchronously. TanStack can
      // promote those queries before hydration and replace the server's
      // loading markup. Native promises deliver settlement asynchronously,
      // preserving the snapshot while still adopting the same server read.
      const promise = Promise.resolve(query.promise);
      void promise.catch(() => undefined);
      return {
        ...query,
        promise,
        meta: { ...query.meta, [SERVER_STREAM_PLACEHOLDER]: true },
      };
    });

    const cache = client.getQueryCache();
    if (serverPass) {
      for (const query of queries) {
        if (query.state.status !== 'pending' || !query.promise) continue;
        const existing = cache.get(query.queryHash);
        // The snapshot is still the placeholder. Drop a cache entry the
        // same read already filled so this render paints that placeholder
        // again. After hydration the client keeps a value it already has.
        if (existing) cache.remove(existing);
      }
    }

    // HydrationBoundary applies a query that already exists only in an
    // effect, after children render. A shell read started while this page
    // is still the streamed loading fallback is pending and has no data, so
    // the first client render would paint that placeholder over the server
    // tree. Drop the empty entry so the snapshot is applied before children
    // render. A query that already holds data stays — a newer client value
    // remains authoritative.
    for (const query of queries) {
      if (query.state.status !== 'success' || query.state.data === undefined) continue;
      const existing = cache.get(query.queryHash);
      if (!existing) continue;
      if (existing.state.status !== 'pending' || existing.state.data !== undefined) continue;
      cache.remove(existing);
    }

    return { ...state, queries };
  }, [client, serverPass, state]);
  return <HydrationBoundary state={initialState}>{children}</HydrationBoundary>;
}
