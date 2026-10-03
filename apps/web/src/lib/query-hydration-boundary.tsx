'use client';

import { useMemo, type ReactNode } from 'react';
import { HydrationBoundary, type DehydratedState } from '@tanstack/react-query';

/** Preserve the pending server snapshot on the first client render. */
export function QueryHydrationBoundary({
  state,
  children,
}: {
  state: DehydratedState;
  children: ReactNode;
}) {
  const initialState = useMemo(
    () => ({
      ...state,
      queries: state.queries.map((query) => {
        if (query.state.status !== 'pending' || !query.promise) return query;
        // Fulfilled Flight thenables invoke .then synchronously. TanStack can
        // promote those queries before hydration and replace the server's
        // loading markup. Native promises deliver settlement asynchronously,
        // preserving the snapshot while still adopting the same server read.
        const promise = Promise.resolve(query.promise);
        void promise.catch(() => undefined);
        return { ...query, promise };
      }),
    }),
    [state],
  );
  return <HydrationBoundary state={initialState}>{children}</HydrationBoundary>;
}
