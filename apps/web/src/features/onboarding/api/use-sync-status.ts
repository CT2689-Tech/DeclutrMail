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
 * By default the mailbox is resolved server-side from the session
 * (D155 + CurrentMailboxGuard). Pass an explicit `mailboxId` to gate a
 * SPECIFIC mailbox (D116): it stamps `X-Active-Mailbox-Id`, so a
 * freshly-connected second account can keep being polled even after the
 * user switches their active mailbox back to the primary.
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

/** Slower cadence while `failed` — a failure may be transient (see below). */
export const SYNC_FAILED_POLL_MS = 10_000;

/**
 * Poll-cadence policy. Stop ONLY on success (`is_ready_for_triage`).
 *
 * A `failed` readiness is NOT treated as terminal for polling: it can be
 * transient — a stale or superseded job (e.g. a reconnect's
 * dead-lettered attempt running with the pre-reconnect token) flips
 * readiness to `failed` moments before the real sync sets `ready`.
 * Halting on `failed` permanently trapped the gate (logs 2026-05-28).
 * So we keep polling at a slower cadence while failed; if readiness
 * flips back to `syncing`/`ready` the gate recovers on its own, and the
 * failed screen's "Try again" still covers a genuinely permanent failure.
 *
 * Exported so it can be unit-tested without racing real timers.
 */
export function syncRefetchInterval(data: SyncStatus | undefined): number | false {
  if (!data) return SYNC_POLL_MS;
  if (data.is_ready_for_triage) return false;
  if (data.readiness_status === 'failed') return SYNC_FAILED_POLL_MS;
  return SYNC_POLL_MS;
}

export function useSyncStatus(mailboxId?: string, opts: { enabled?: boolean } = {}) {
  return useQuery({
    // Key by mailbox so two gates (primary + a syncing secondary) never
    // share a cache entry.
    queryKey: [...SYNC_STATUS_KEY, mailboxId ?? null] as const,
    queryFn: async ({ signal }) => {
      const envelope = await apiGet<SyncStatus>('/api/v1/sync/status', { signal, mailboxId });
      return envelope.data;
    },
    // `enabled: false` lets the onboarding step machine hold the poll
    // off while there is NO active mailbox (a session-resolved call
    // would 409 NO_ACTIVE_MAILBOX every 3s — the designed-state-not-
    // retry rule, CLAUDE.md §8). Existing callers pass nothing.
    enabled: opts.enabled ?? true,
    refetchInterval: (query) => syncRefetchInterval(query.state.data),
    // The gate is the whole point of the screen — keep it fresh.
    staleTime: 0,
  });
}
