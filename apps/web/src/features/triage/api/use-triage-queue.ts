/**
 * `useTriageQueue` + `useTriageStats` + `useTodaySummary` — TanStack
 * Query hooks for the Triage daily ritual (D20, D29, D30, D33, D214).
 *
 * All three are `select`s over ONE query, not three requests — the strip's
 * numbers are computed from the queue rows, so separate fetches let it
 * describe a queue that is not the one on screen. See `query-keys.ts`.
 *
 * Stale time: 30s. The queue evolves slowly relative to think time,
 * and a re-fetch on every focus would flicker mid-decision.
 */

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api/client';
import { type TriageBootstrap, triageBootstrapQueryOptions } from './query-options';

export { TRIAGE_BOOTSTRAP_KEY } from './query-options';
export type { TriageBootstrap } from './query-options';

/**
 * D214 — the "Today" strip payload. Mirrors the BE `TodaySummary`
 * (apps/api/src/triage/triage.read-service.ts) verbatim.
 */
export interface TodaySummary {
  receivedToday: number;
  sendersToday: number;
  handledAutomatically: number;
  queuedDecisions: number;
  /**
   * Non-Keep subset of `queuedDecisions` — the set `noiseReductionPct`
   * describes.
   *
   * OPTIONAL on purpose, though the API always sends it. Nothing validates
   * this shape at runtime: `apiGet` casts the parsed JSON. During a deploy
   * an older API revision answers a newer web bundle, and the field is then
   * genuinely absent — so declaring it required states a guarantee the wire
   * does not make, and `undefined` would flow into the comparison that picks
   * the sentence's subject. Optional forces the caller to handle the case.
   */
  noiseSenderCount?: number;
  noiseReductionPct: number | null;
}

async function readTriageBootstrap(signal: AbortSignal): Promise<TriageBootstrap> {
  const envelope = await apiGet<TriageBootstrap>('/api/triage/bootstrap', { signal });
  return envelope.data;
}

/**
 * The queue rows, the session stats and the D214 Today strip — three views
 * of ONE cache entry, never three requests.
 *
 * Each hook is a `select` over the same query, so they cannot disagree: same
 * fetch, same instant, same copy of the queue. The strip's percentage is
 * computed from the very rows rendered beneath it. See `query-keys.ts`.
 */
export function useTriageQueue() {
  return useQuery({
    ...triageBootstrapQueryOptions(readTriageBootstrap),
    select: (data: TriageBootstrap) => data.queue,
  });
}

export function useTriageStats() {
  return useQuery({
    ...triageBootstrapQueryOptions(readTriageBootstrap),
    select: (data: TriageBootstrap) => data.stats,
  });
}

export function useTodaySummary() {
  return useQuery({
    ...triageBootstrapQueryOptions(readTriageBootstrap),
    select: (data: TriageBootstrap) => data.todaySummary,
  });
}
