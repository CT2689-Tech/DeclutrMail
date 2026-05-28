/**
 * `useTriageQueue` + `useTriageStats` — TanStack Query hooks for the
 * Triage daily ritual (D20, D29, D30, D33).
 *
 * The two queries fire in parallel; the page composes a
 * `TriageScreenState` from their combined results so the existing
 * `<TriageScreen state={...}/>` rendering tree (which was fixture-fed
 * before D155 landed) consumes them unchanged.
 *
 * Stale time: 30s. The queue evolves slowly relative to think time,
 * and a re-fetch on every focus would flicker mid-decision.
 */

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api/client';
import type { TriageDecisionRow, TriageSessionStats } from '@/features/triage/data';

export const TRIAGE_QUEUE_KEY = ['triage', 'queue'] as const;
export const TRIAGE_STATS_KEY = ['triage', 'stats'] as const;

export function useTriageQueue() {
  return useQuery({
    queryKey: TRIAGE_QUEUE_KEY,
    queryFn: async ({ signal }) => {
      const envelope = await apiGet<TriageDecisionRow[]>('/api/triage/queue', {
        signal,
      });
      return envelope.data;
    },
    staleTime: 30_000,
  });
}

export function useTriageStats() {
  return useQuery({
    queryKey: TRIAGE_STATS_KEY,
    queryFn: async ({ signal }) => {
      const envelope = await apiGet<TriageSessionStats>('/api/triage/stats', {
        signal,
      });
      return envelope.data;
    },
    staleTime: 30_000,
  });
}
