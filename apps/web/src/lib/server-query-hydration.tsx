import 'server-only';

import { dehydrate, HydrationBoundary, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { makeServerQueryClient, settleServerQueries } from './server-query-client';

export type ServerQueryPrefetch = (queryClient: QueryClient) => Array<Promise<unknown>>;
export type ServerQueryChildren = ReactNode | ((queryClient: QueryClient) => ReactNode);

/**
 * Shared server-to-TanStack bridge for authenticated App Router reads.
 *
 * Feature code supplies the same pure query-option factories its client
 * hooks use. Successful reads are serialized into the nearest hydration
 * boundary; designed failures and outages leave the entry absent so the
 * existing client query remains the recovery path.
 */
export async function ServerQueryHydration({
  surface,
  prefetch,
  children,
}: {
  surface: string;
  prefetch: ServerQueryPrefetch;
  children: ServerQueryChildren;
}) {
  const queryClient = makeServerQueryClient();
  await settleServerQueries(surface, prefetch(queryClient));
  const content = typeof children === 'function' ? children(queryClient) : children;

  return <HydrationBoundary state={dehydrate(queryClient)}>{content}</HydrationBoundary>;
}
