'use client';

import { useMemo, type ReactNode } from 'react';
import { HydrationBoundary, useQueryClient, type DehydratedState } from '@tanstack/react-query';

/** Preserve the pending server snapshot on the first client render. */
export function QueryHydrationBoundary({
  state,
  children,
}: {
  state: DehydratedState;
  children: ReactNode;
}) {
  const client = useQueryClient();
  const initialState = useMemo(() => {
    const queries = state.queries.map((query) => {
      if (query.state.status !== 'pending' || !query.promise) return query;
      // Fulfilled Flight thenables invoke .then synchronously. TanStack can
      // promote those queries before hydration and replace the server's
      // loading markup. Native promises deliver settlement asynchronously,
      // preserving the snapshot while still adopting the same server read.
      const promise = Promise.resolve(query.promise);
      void promise.catch(() => undefined);
      return { ...query, promise };
    });

    // HydrationBoundary applies a query that already exists only in an
    // effect, after children render. A shell read started while this page
    // is still the streamed loading fallback is pending and has no data, so
    // the first client render would paint that placeholder over the server
    // tree. Drop the empty entry so the snapshot is applied before children
    // render. A query that already holds data stays — a newer client value
    // remains authoritative.
    const cache = client.getQueryCache();
    for (const query of queries) {
      if (query.state.status !== 'success' || query.state.data === undefined) continue;
      const existing = cache.get(query.queryHash);
      if (!existing) continue;
      if (existing.state.status !== 'pending' || existing.state.data !== undefined) continue;
      cache.remove(existing);
    }

    return { ...state, queries };
  }, [client, state]);
  return <HydrationBoundary state={initialState}>{children}</HydrationBoundary>;
}
