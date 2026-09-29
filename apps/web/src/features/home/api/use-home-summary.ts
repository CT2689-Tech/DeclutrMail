/**
 * `useHomeSummary` — all-time cleanup totals for the active mailbox.
 *
 * Reads `GET /api/activity/summary?window=all`
 * (`apps/api/src/activity/activity.read-service.ts` `summarizeActivity`):
 * `activity_log` rows for the five canonical verbs, excluding any row
 * with `reverted_at` set — an undone action never counts.
 *
 * Retry policy is the app default (`retryTransientOnly`): a guard 409 or
 * any other 4xx is a designed state and is never retried.
 */

import { useQuery } from '@tanstack/react-query';
import type { CanonicalVerb } from '@declutrmail/shared/contracts';

import { apiGet } from '@/lib/api/client';
import { homeKeys } from './query-keys';

/** Wire shape — mirrors the API's `ActivitySummary`, minus what Home ignores. */
export interface HomeSummary {
  /** `occurred_at` of the earliest counted row; null when none. */
  since: string | null;
  /** `COUNT(DISTINCT sender_key)` over counted rows. */
  decidedSenders: number;
  /**
   * `SUM(affected_count)` per verb.
   *
   * OPTIONAL though the API always sends it: nothing validates this
   * shape at runtime, and web deploys independently of the API. An older
   * API revision omits the field, and Home then has no per-verb email
   * count to total — it must fall back, not read `undefined.archive`.
   */
  emailsByVerb?: Partial<Record<CanonicalVerb, number>>;
}

export function useHomeSummary(options: { enabled: boolean }) {
  return useQuery({
    queryKey: homeKeys.summary(),
    queryFn: async ({ signal }) => {
      const envelope = await apiGet<HomeSummary>('/api/activity/summary?window=all', { signal });
      return envelope.data;
    },
    enabled: options.enabled,
  });
}
