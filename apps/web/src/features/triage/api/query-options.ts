import { queryOptions } from '@tanstack/react-query';

import type { TriageDecisionRow, TriageSessionStats } from '@/features/triage/data';
import type { TodaySummary } from './use-triage-queue';
import { TRIAGE_BOOTSTRAP_KEY } from './query-keys';

export { TRIAGE_BOOTSTRAP_KEY };

/** Everything the Triage route renders, from one request. */
export interface TriageBootstrap {
  queue: TriageDecisionRow[];
  stats: TriageSessionStats;
  todaySummary: TodaySummary;
}

type TriageReader<T> = (signal: AbortSignal) => Promise<T>;

/**
 * The single Triage query. The queue, the stats and the Today strip all
 * `select` from this one cache entry — see `query-keys.ts` for why they are
 * not three queries.
 *
 * 30s stale time: the strip is situational awareness, not a live ticker.
 */
export function triageBootstrapQueryOptions(reader: TriageReader<TriageBootstrap>) {
  return queryOptions({
    queryKey: TRIAGE_BOOTSTRAP_KEY,
    queryFn: ({ signal }) => reader(signal),
    staleTime: 30_000,
  });
}
