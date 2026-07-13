/**
 * `useSyncStatus` — TanStack Query hook for the onboarding sync gate
 * (D109, D224).
 *
 * Polls `GET /api/v1/sync/status` every 3s while the mailbox is still
 * syncing, every 10s while a failed initial sync may be recovering, and
 * every 60s once ready. The slow ready cadence keeps the app shell's
 * freshness timestamp + passive incremental-failure banner honest in a
 * long-lived tab without turning the status endpoint into a hot poll.
 *
 * By default the mailbox is resolved server-side from the session
 * (D155 + CurrentMailboxGuard). Pass an explicit `mailboxId` to gate a
 * SPECIFIC mailbox (D116): it stamps `X-Active-Mailbox-Id`, so a
 * freshly-connected second account can keep being polled even after the
 * user switches their active mailbox back to the primary.
 *
 * Transport is poll-only by design (D224): there is no push channel.
 * 3s matches the controller's rate-limit headroom (120/min = 2/s), and
 * the 60s ready cadence preserves ample headroom for app-shell and
 * per-mailbox Settings observers.
 */

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api/client';
import type { SyncStatus } from '@declutrmail/shared/contracts';

export const SYNC_STATUS_KEY = ['sync', 'status'] as const;

/** Poll cadence in ms — D109/D224 spec. */
export const SYNC_POLL_MS = 3_000;

/** Slower cadence while `failed` — a failure may be transient (see below). */
export const SYNC_FAILED_POLL_MS = 10_000;

/** Low-frequency health refresh after initial sync has completed. */
export const SYNC_READY_POLL_MS = 60_000;

/**
 * Poll-cadence policy. Ready mailboxes keep a low-frequency health poll
 * because sync status has no push transport: otherwise a mounted app
 * never observes a later incremental success or terminal failure.
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
export function syncRefetchInterval(data: SyncStatus | undefined): number {
  if (!data) return SYNC_POLL_MS;
  if (data.is_ready_for_triage) return SYNC_READY_POLL_MS;
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
    // Global query defaults disable focus refetches to prevent storms.
    // Sync health is the narrow exception: a backgrounded tab may have
    // paused its timer, so returning should immediately restore truth.
    refetchOnWindowFocus: true,
    // The gate is the whole point of the screen — keep it fresh.
    staleTime: 0,
  });
}
