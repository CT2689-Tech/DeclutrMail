/**
 * `useSenderMessages` — paginated recent-messages query (D41, D46).
 *
 * `useInfiniteQuery` because D46 caps the inline view at 10 rows but
 * the underlying list can be paged through "View more". The default
 * BE limit is 10 (max 50); we forward the page-size if the caller
 * overrides it.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchSenderMessages } from '@/lib/api/senders';
import { senderMessagesQueryOptions } from './query-options';

export interface UseSenderMessagesOptions {
  /** Page size — default 10 per D46. */
  limit?: number | undefined;
  scope?: 'all_mail' | 'inbox' | 'archived' | undefined;
  /** Subscribe to cached pages without starting a second default-scope fetch. */
  enabled?: boolean | undefined;
}

export function useSenderMessages(id: string, options: UseSenderMessagesOptions = {}) {
  return useInfiniteQuery({
    ...senderMessagesQueryOptions(
      id,
      (cursor, signal) =>
        fetchSenderMessages(id, { limit: options.limit, cursor, scope: options.scope }, signal),
      options.scope,
    ),
    enabled: id.length > 0 && options.enabled !== false,
  });
}
