/**
 * `useSenderSuggestions` — typeahead query for the senders search box.
 *
 * Spans the ENTIRE mailbox (not just the loaded list page), so a search
 * for "amazon" returns matches even when no Amazon sender sits on the
 * current scroll page. Mailbox-scoped server-side.
 *
 * `enabled` is gated on a non-empty trimmed query — the empty-string
 * case never hits the network. `retry: false` because a read 4xx is a
 * designed state (CLAUDE.md §8 — no read-guard retry storms).
 * `staleTime: 0` keeps the dropdown current as senders churn under us.
 *
 * Debouncing lives at the call site (the SenderSearch component) — the
 * hook stays a pure cache over (q, limit).
 */

import { useQuery } from '@tanstack/react-query';

import { fetchSenderSuggestions, type SenderSuggestionDto } from '@/lib/api/senders';

export interface UseSenderSuggestionsResult {
  suggestions: SenderSuggestionDto[];
  loading: boolean;
  error: boolean;
}

export function useSenderSuggestions(
  q: string,
  options: { limit?: number; enabled?: boolean } = {},
): UseSenderSuggestionsResult {
  const trimmed = q.trim();
  const limit = options.limit ?? 8;
  const enabled = (options.enabled ?? true) && trimmed.length > 0;
  const query = useQuery({
    queryKey: ['sender-suggest', trimmed, limit] as const,
    queryFn: ({ signal }) =>
      fetchSenderSuggestions(trimmed, { limit, signal }).then((env) => env.data.senders),
    enabled,
    retry: false,
    staleTime: 0,
  });
  return {
    suggestions: enabled ? (query.data ?? []) : [],
    loading: enabled && query.isLoading,
    error: enabled && query.isError,
  };
}
