import { queryOptions } from '@tanstack/react-query';

import type { TriageDecisionRow, TriageSessionStats } from '@/features/triage/data';
import type { TodaySummary } from './use-triage-queue';

export const TRIAGE_QUEUE_KEY = ['triage', 'queue'] as const;
export const TRIAGE_STATS_KEY = ['triage', 'stats'] as const;
export const TODAY_SUMMARY_KEY = ['triage', 'today-summary'] as const;

type TriageReader<T> = (signal: AbortSignal) => Promise<T>;

export function triageQueueQueryOptions(reader: TriageReader<TriageDecisionRow[]>) {
  return queryOptions({
    queryKey: TRIAGE_QUEUE_KEY,
    queryFn: ({ signal }) => reader(signal),
    staleTime: 30_000,
  });
}

export function triageStatsQueryOptions(reader: TriageReader<TriageSessionStats>) {
  return queryOptions({
    queryKey: TRIAGE_STATS_KEY,
    queryFn: ({ signal }) => reader(signal),
    staleTime: 30_000,
  });
}

export function todaySummaryQueryOptions(reader: TriageReader<TodaySummary>) {
  return queryOptions({
    queryKey: TODAY_SUMMARY_KEY,
    queryFn: ({ signal }) => reader(signal),
    staleTime: 30_000,
  });
}
