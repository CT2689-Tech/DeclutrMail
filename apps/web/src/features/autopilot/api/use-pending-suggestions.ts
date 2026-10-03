import { useQuery } from '@tanstack/react-query';
import { fetchPendingSuggestions } from '@/lib/api/autopilot';
import { pendingSuggestionsPageQueryOptions } from './query-options';

/** One bounded page; mutations invalidate this and Home through the shared prefix. */
export function usePendingSuggestions(mailboxId: string | null, cursor?: string) {
  return useQuery(
    pendingSuggestionsPageQueryOptions(
      mailboxId,
      (signal) => fetchPendingSuggestions(signal, cursor),
      cursor,
    ),
  );
}
