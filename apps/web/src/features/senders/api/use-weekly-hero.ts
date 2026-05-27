/**
 * `useWeeklyHero` — TanStack Query hook for the Weekly Hero slices
 * (D47, D48).
 *
 * Singleton query — there's one Hero per mailbox. No infinite-query
 * shape because the response is already bounded (3 slices × ≤ 24
 * senders) and the user re-renders the screen, not paginates the
 * Hero.
 *
 * Why TanStack Query (D200) at all for a one-shot fetch? Because the
 * Hero shares the same cache and stale-time semantics as the senders
 * list — a window focus or an action mutation should re-fetch the
 * Hero alongside the list so the cards reflect current state without
 * a manual reload.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchWeeklyHero } from '@/lib/api/senders';
import { sendersKeys } from './query-keys';

export function useWeeklyHero() {
  return useQuery({
    queryKey: sendersKeys.weeklyHero(),
    queryFn: ({ signal }) => fetchWeeklyHero(signal),
    // Hero slices are computed on the read path; they're fresh on
    // every fetch. Keep the default staleTime so we don't refetch
    // on every focus during a single session.
  });
}
