/**
 * `useSenderDetail` — TanStack Query hook for a single sender (D40).
 *
 * The detail page composes four queries — detail, messages, timeseries,
 * history — each cached independently so a mutation on (say) messages
 * doesn't blow away the timeseries cache. The detail query is the
 * gateway: when it 404s, the page renders not-found and the children
 * are not mounted.
 *
 * Error mapping: the underlying `ApiError` carries the HTTP status;
 * callers check `error instanceof ApiError && error.status === 404`
 * to render the not-found branch.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchSenderDetail } from '@/lib/api/senders';
import { sendersKeys } from './query-keys';

export function useSenderDetail(id: string) {
  return useQuery({
    queryKey: sendersKeys.detail(id),
    queryFn: ({ signal }) => fetchSenderDetail(id, signal),
    // Don't retry 404s — they're permanent for the given id (until a
    // future sync surfaces the sender). TanStack's default retry would
    // make the not-found branch appear to "hang" for ~5 seconds.
    retry: (failureCount, error) => {
      if (
        error &&
        typeof error === 'object' &&
        'status' in error &&
        (error as { status: number }).status === 404
      ) {
        return false;
      }
      return failureCount < 2;
    },
    // Don't fetch on an empty id — guards against a routing edge case
    // where the page mounts before params resolve.
    enabled: id.length > 0,
  });
}
