/**
 * Screener TanStack Query hooks (D71–D77, D200).
 *
 * Queue + count are reads over `/api/screener/*`; decide is the
 * mutation that records a K/A/U/L/D verdict (the BE delegates to the
 * existing action pipeline and resolves the quarantine row).
 *
 * Mount-site rule (D77): callers gate these hooks on the workspace
 * tier (`useTier` + `hasCapability(tier, 'screener')`) so Free/Plus
 * sessions never fire a request the server would 402.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ME_QUERY_KEY } from '@/features/auth/api/use-me';
import { apiGet, apiPost } from '@/lib/api/client';
import { defaultLaterWakeAt, newIdempotencyKey } from '@/lib/api/actions';

import type { ScreenerDecideResult, ScreenerDecideVerb, ScreenerQueueRow } from '../data';

export const SCREENER_QUEUE_KEY = ['screener', 'queue'] as const;
export const SCREENER_COUNT_KEY = ['screener', 'count'] as const;

/** Badge poll cadence (D74) — slow; `Queue.add`-style push isn't a thing here. */
export const SCREENER_COUNT_POLL_MS = 60_000;

export function useScreenerQueue(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: SCREENER_QUEUE_KEY,
    queryFn: async ({ signal }) => {
      const envelope = await apiGet<ScreenerQueueRow[]>('/api/screener/queue', { signal });
      return envelope.data;
    },
    enabled: options.enabled ?? true,
    staleTime: 30_000,
  });
}

/**
 * Sidebar badge count (D74). Polls while mounted so a new sender
 * landing mid-session moves the badge (the pulse reacts to the
 * increase). `retry: false` — a read 4xx (guard 409 / tier 402) is a
 * designed state, never something to hammer (§8).
 */
export function useScreenerCount(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: SCREENER_COUNT_KEY,
    queryFn: async ({ signal }) => {
      const envelope = await apiGet<{ pending: number }>('/api/screener/count', { signal });
      return envelope.data;
    },
    enabled: options.enabled ?? true,
    staleTime: 30_000,
    refetchInterval: SCREENER_COUNT_POLL_MS,
    retry: false,
  });
}

/**
 * Record a decision for a queued sender. One fresh idempotency key per
 * mutate call (D202): a network-retried POST replays server-side; a
 * fresh user click is a new decision. A 402 FREE_CAP_REACHED (Free
 * tier exhausting its 5 lifetime cleanup actions via the delegated
 * pipeline) surfaces the UpgradeModal via the global MutationCache
 * handler (lib/query-client) — no per-hook wiring needed.
 */
export function useScreenerDecide() {
  const qc = useQueryClient();
  return useMutation<
    ScreenerDecideResult,
    Error,
    {
      senderId: string;
      verb: ScreenerDecideVerb;
      olderThanDays?: number | null;
      wakeAt?: string;
      /** Explicit "act anyway" on a Protected sender (D42/D245). */
      override?: boolean;
    }
  >({
    mutationFn: async ({ senderId, verb, olderThanDays, wakeAt, override }) => {
      const envelope = await apiPost<ScreenerDecideResult>(
        '/api/screener/decide',
        {
          senderId,
          verb,
          ...(olderThanDays != null ? { olderThanDays } : {}),
          ...(verb === 'later' ? { wakeAt: wakeAt ?? defaultLaterWakeAt() } : {}),
          ...(override === true ? { override: true } : {}),
        },
        { headers: { 'Idempotency-Key': newIdempotencyKey() } },
      );
      return envelope.data;
    },
    onSuccess: () => {
      // Screener decides ride the same metered pipeline — refresh the
      // frozen quota counter (flow audit 2026-07-28).
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}
