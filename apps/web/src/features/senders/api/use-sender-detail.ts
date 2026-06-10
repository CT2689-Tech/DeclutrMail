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
import { retryUnless4xx } from './retry';

export function useSenderDetail(id: string) {
  return useQuery({
    queryKey: sendersKeys.detail(id),
    queryFn: ({ signal }) => fetchSenderDetail(id, signal),
    // Don't retry 404s — they're permanent for the given id (until a
    // future sync surfaces the sender). TanStack's default retry would
    // make the not-found branch appear to "hang" for ~5 seconds. The
    // sibling sender-scoped hooks share this predicate so all four
    // panes short-circuit consistently when the id is stale.
    retry: retryUnless4xx,
    // Don't fetch on an empty id — guards against a routing edge case
    // where the page mounts before params resolve.
    enabled: id.length > 0,
  });
}
