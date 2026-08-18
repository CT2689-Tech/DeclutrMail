/**
 * `useFollowups` — TanStack Query hook for the Followups awaiting list.
 *
 * Plain `useQuery` (not infinite) — the BE clamps the response at 100
 * rows and the Followups screen never paginates beyond that at V2.
 * D85 priority bucket is computed server-side from the request clock
 * and arrives on the wire; the FE only groups + renders.
 *
 * The default `staleTime` (30s, set in `makeQueryClient`) is intentional
 * for this list — followups state changes on a 6h worker cadence, so
 * aggressive refetching would create flicker without surfacing new
 * data sooner than the worker writes it.
 */

import { useQuery } from '@tanstack/react-query';

import { fetchFollowups } from '@/lib/api/followups';

import { followupsQueryOptions } from './query-options';

export function useFollowups() {
  return useQuery({
    ...followupsQueryOptions(fetchFollowups),
    select: (envelope) => envelope.data,
  });
}
