/**
 * `usePendingSuggestions` — TanStack Query hook for the D104 Observe-
 * mode buffer. The pending-suggestions endpoint returns up to 50 rows
 * (newest first); the FE consumes them as a flat list.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchPendingSuggestions } from '@/lib/api/autopilot';
import { autopilotKeys } from './query-keys';

export function usePendingSuggestions() {
  return useQuery({
    queryKey: autopilotKeys.pendingSuggestions(),
    queryFn: ({ signal }) => fetchPendingSuggestions(signal).then((env) => env.data),
  });
}
