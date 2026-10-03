import 'server-only';

import { dehydrate, HydrationBoundary, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import {
  makeServerQueryClient,
  settleServerQueries,
  type ServerHydrationSurface,
} from './server-query-client';
import { StreamedQueryRecoveryError } from './streamed-query-recovery';

export type ServerQueryPrefetch = (queryClient: QueryClient) => Array<Promise<unknown>>;
export type ServerQueryChildren = ReactNode | ((queryClient: QueryClient) => ReactNode);

/**
 * Shared server-to-TanStack bridge for authenticated App Router reads.
 *
 * Feature code supplies the same pure query-option factories its client
 * hooks use. Successful reads are serialized into the nearest hydration
 * boundary. Optional section reads can opt into pending-promise streaming;
 * failures before the snapshot are omitted, and late failures are redacted
 * by TanStack before the existing browser query becomes the recovery path.
 */
export async function ServerQueryHydration({
  surface,
  prefetch,
  streamPrefetch,
  children,
}: {
  surface: ServerHydrationSurface;
  prefetch: ServerQueryPrefetch;
  /** Optional section reads may stream without holding primary content. */
  streamPrefetch?: ServerQueryPrefetch;
  children: ServerQueryChildren;
}) {
  const queryClient = makeServerQueryClient();
  const primaryQueries = prefetch(queryClient);
  const streamedClient = streamPrefetch ? makeServerQueryClient() : undefined;
  if (streamedClient && streamPrefetch) {
    // Separate deadline owners: timing out an optional section must never
    // cancel the primary reads. Settlement owns aborts and diagnostics.
    void settleServerQueries(surface, streamPrefetch(streamedClient), streamedClient);
  }
  await settleServerQueries(surface, primaryQueries, queryClient);
  const content = typeof children === 'function' ? children(queryClient) : children;
  const state = dehydrate(queryClient);
  if (streamedClient) {
    const streamedState = dehydrate(streamedClient, {
      shouldDehydrateQuery: (query) =>
        query.state.status === 'success' ||
        (query.state.status === 'pending' && query.state.fetchStatus === 'fetching'),
    });
    for (const query of streamedState.queries) {
      if (query.promise) {
        // TanStack already redacted the rejection. Identify only this
        // recovery transport so Next does not duplicate the original
        // classified failure/deadline diagnostics as a render defect.
        query.promise = query.promise.catch(() => {
          throw new StreamedQueryRecoveryError();
        });
        // A disconnected render may never consume the snapshot. Observe
        // rejection without replacing the promise its browser must adopt.
        void query.promise.catch(() => undefined);
      }
    }
    state.queries.push(...streamedState.queries);
  }

  return <HydrationBoundary state={state}>{content}</HydrationBoundary>;
}
