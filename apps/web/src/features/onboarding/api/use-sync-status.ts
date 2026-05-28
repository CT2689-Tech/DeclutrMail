/**
 * `useSyncStatus` — TanStack Query hook for the onboarding sync gate
 * (D109, D224).
 *
 * Polls `GET /api/v1/sync/status` every 3s while the mailbox is still
 * syncing. The poll STOPS (refetchInterval → false) once the backend
 * reports a terminal state — `is_ready_for_triage` (success) or
 * `readiness_status === 'failed'` — so a ready mailbox doesn't keep
 * hammering the endpoint.
 *
 * The mailbox is resolved server-side from the session (D155 +
 * CurrentMailboxGuard); the FE sends no mailbox id.
 *
 * Transport is poll-only by design (D224): there is no push channel.
 * 3s matches the controller's rate-limit headroom (120/min = 2/s).
 */

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api/client';
import type { SyncStatus } from '@declutrmail/shared/contracts';

export const SYNC_STATUS_KEY = ['sync', 'status'] as const;

/** Poll cadence in ms — D109/D224 spec. */
export const SYNC_POLL_MS = 3_000;

/**
 * Poll-cadence policy: keep polling every {@link SYNC_POLL_MS} until the
 * sync reaches a terminal state (`is_ready_for_triage` success or
 * `readiness_status === 'failed'`), then stop (`false`). Exported so it
 * can be unit-tested without racing real timers.
 */
export function syncRefetchInterval(data: SyncStatus | undefined): number | false {
  if (!data) return SYNC_POLL_MS;
  if (data.is_ready_for_triage || data.readiness_status === 'failed') return false;
  return SYNC_POLL_MS;
}

export function useSyncStatus() {
  return useQuery({
    queryKey: SYNC_STATUS_KEY,
    queryFn: async ({ signal }) => {
      const envelope = await apiGet<SyncStatus>('/api/v1/sync/status', { signal });
      return envelope.data;
    },
    refetchInterval: (query) => syncRefetchInterval(query.state.data),
    // The gate is the whole point of the screen — keep it fresh.
    staleTime: 0,
  });
}
