/**
 * `useTriageQueue` + `useTriageStats` + `useTodaySummary` — TanStack
 * Query hooks for the Triage daily ritual (D20, D29, D30, D33, D214).
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
import { triageQueueQueryOptions, triageStatsQueryOptions } from './query-options';

export { TRIAGE_QUEUE_KEY, TRIAGE_STATS_KEY } from './query-options';
export const TODAY_SUMMARY_KEY = ['triage', 'today-summary'] as const;

/**
 * D214 — the "Today" strip payload. Mirrors the BE `TodaySummary`
 * (apps/api/src/triage/triage.read-service.ts) verbatim.
 */
export interface TodaySummary {
  receivedToday: number;
  sendersToday: number;
  handledAutomatically: number;
  queuedDecisions: number;
  noiseReductionPct: number | null;
}

async function readTriageQueue(signal: AbortSignal): Promise<TriageDecisionRow[]> {
  const envelope = await apiGet<TriageDecisionRow[]>('/api/triage/queue', { signal });
  return envelope.data;
}

async function readTriageStats(signal: AbortSignal): Promise<TriageSessionStats> {
  const envelope = await apiGet<TriageSessionStats>('/api/triage/stats', { signal });
  return envelope.data;
}

export function useTriageQueue() {
  return useQuery(triageQueueQueryOptions(readTriageQueue));
}

export function useTriageStats() {
  return useQuery(triageStatsQueryOptions(readTriageStats));
}

/**
 * D214 — data for `<TodayStrip>`. Same 30s stale time as its siblings;
 * the strip is situational awareness, not a live ticker. The Brief
 * feature (D189) reuses this query when it lands.
 */
export function useTodaySummary() {
  return useQuery({
    queryKey: TODAY_SUMMARY_KEY,
    queryFn: async ({ signal }) => {
      const envelope = await apiGet<TodaySummary>('/api/triage/today-summary', {
        signal,
      });
      return envelope.data;
    },
    staleTime: 30_000,
  });
}
