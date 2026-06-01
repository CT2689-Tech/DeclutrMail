/**
 * `useSendersSummary` — TanStack Query hook for the mailbox-wide
 * aggregates that drive the Senders screen's hero, KPI strip, and intent
 * chips (#145, "real-data counts" mandate).
 *
 * Why a separate hook (not derived from the loaded list page)? The list
 * endpoint paginates at 50 rows; the FE used to compute `noiseReductionPct`
 * + `protectedCount` + chip counts over that loaded slice, which made
 * every headline number wrong for mailboxes larger than one page. The
 * summary endpoint resolves the totals server-side over the WHOLE
 * mailbox in a single aggregate query — see
 * `apps/api/src/senders/senders.read-service.ts:getSenderSummary` for
 * the SQL.
 *
 * `q` is forwarded so chip / KPI / hero counts narrow in lockstep with
 * the rendered rows when the user types in the search box. The key
 * partitions by `q`, so each active search caches separately and
 * `keepPreviousData` is unnecessary (TanStack returns the stale entry
 * for the new key while the request is in flight).
 *
 * Mailbox switch: `resetMailboxScopedCache` calls
 * `invalidateQueries()` with no filter, so this hook refetches alongside
 * the senders list when the active mailbox changes — no extra wiring
 * needed (see `reset-mailbox-cache.ts` for the rationale).
 */

import { useQuery } from '@tanstack/react-query';
import { fetchSendersSummary } from '@/lib/api/senders';
import { sendersKeys } from './query-keys';

export function useSendersSummary(params: { q?: string | undefined } = {}) {
  const q = params.q && params.q.length > 0 ? params.q : undefined;
  return useQuery({
    queryKey: sendersKeys.summary({ q }),
    queryFn: ({ signal }) => fetchSendersSummary({ q }, signal),
  });
}
