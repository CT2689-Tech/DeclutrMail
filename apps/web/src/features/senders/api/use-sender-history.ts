/**
 * `useSenderHistory` — paginated decision history (D46).
 *
 * The detail page surfaces the 10 most recent rows inline; "View full
 * history →" navigates to the activity log. Cursor pagination keeps
 * the inline list honest against concurrent inserts (e.g. an Autopilot
 * worker writing a new row while the user is reading the page).
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchSenderHistory } from '@/lib/api/senders';
import { senderHistoryQueryOptions } from './query-options';

export interface UseSenderHistoryOptions {
  /** Page size — default 10 per D46. */
  limit?: number | undefined;
}

export function useSenderHistory(id: string, options: UseSenderHistoryOptions = {}) {
  return useInfiniteQuery({
    ...senderHistoryQueryOptions(id, (cursor, signal) =>
      fetchSenderHistory(id, { limit: options.limit, cursor }, signal),
    ),
    enabled: id.length > 0,
  });
}
