/**
 * `useMe` — TanStack Query hook for `GET /api/auth/me`.
 *
 * Drives the AuthProvider + the account menu. The query is loaded once
 * at app mount and re-fetched on window focus so a session revoked in
 * another tab surfaces as a 401 (which the apiClient routes to the
 * login redirect).
 */

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SyncReadiness } from '@declutrmail/shared/contracts';
import { apiGet, apiPatch, ApiError } from '@/lib/api/client';
import { ME_QUERY_KEY, type Me } from './me-contract';

export { ME_QUERY_KEY, type Me, type MeMailbox, type MeUser, type Tier } from './me-contract';

/** Non-terminal readiness states — a mailbox here is still syncing. */
const SYNCING_READINESS: ReadonlyArray<SyncReadiness> = ['queued', 'syncing'];

/** Poll cadence for `me` while a mailbox's initial sync is in flight. */
export const ME_SYNC_POLL_MS = 4_000;

/** True when any active mailbox is still doing its initial sync. */
export function meHasSyncingMailbox(data: Me | undefined): boolean {
  if (!data) return false;
  return data.mailboxes.some(
    (m) => m.status === 'active' && m.readiness !== null && SYNCING_READINESS.includes(m.readiness),
  );
}

/** True while a durable mailbox-data purge can still advance in the background. */
export function meHasDataDeletionInFlight(data: Me | undefined): boolean {
  if (!data) return false;
  return data.mailboxes.some((m) =>
    ['deletion_pending', 'deleting', 'deletion_delayed'].includes(m.indexedDataState ?? ''),
  );
}

/**
 * The `me` fetch + retry policy, shared by every observer of
 * {@link ME_QUERY_KEY}.
 *
 * It is shared rather than inlined because a TanStack query is ONE object
 * that all of its observers write their full options onto — `useQuery`
 * re-runs `observer.setOptions(query)` in an effect on every render, so the
 * query's resting options are whichever observer re-rendered last. If two
 * observers of the same key disagree about `queryFn` or `retry`, a keyless
 * refetch (`invalidateQueries` → `query.fetch(undefined, …)`) silently picks
 * the loser. Identical options make that race unobservable.
 */
function meQueryOptions() {
  return {
    queryKey: ME_QUERY_KEY,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const envelope = await apiGet<Me>('/api/auth/me', { signal });
      return envelope.data;
    },
    retry: (failureCount: number, error: Error) => {
      if (error instanceof ApiError && error.status === 401) return false;
      return failureCount < 2;
    },
    staleTime: 60_000,
    // The client-wide default is `false` — a focus refetch across EVERY
    // query is a request storm. `me` is the one read worth the round trip:
    // it is how a session revoked in another tab becomes a 401 (and the
    // login redirect), and it is the app's cheapest route out of a failed
    // refresh. One request per focus at most, behind the 60s staleTime.
    refetchOnWindowFocus: true,
  };
}

/** Retry cadence while `me` has failed and the app has no session to render. */
export const ME_ERROR_RETRY_MS = 15_000;

/**
 * Returns the authenticated identity + connected mailboxes, or `null`
 * data + `error` set to an ApiError(401) when the session is missing.
 * `retry: false` so the unauthenticated state surfaces immediately
 * instead of looping.
 *
 * While any mailbox is still syncing (e.g. a freshly-connected second
 * account), `me` polls every {@link ME_SYNC_POLL_MS} so the account
 * switcher's "Syncing…→Ready" badge + the ready toast update without a
 * manual refresh (D116). Polling stops once every mailbox is terminal.
 */
export function useMe() {
  const queryClient = useQueryClient();
  const query = useQuery({
    ...meQueryOptions(),
    // Scheduling, not identity — `refetchInterval` is read off the OWN
    // observer, never off the shared query, so it is the one option that
    // may legitimately live here instead of in `meQueryOptions`.
    refetchInterval: (query) => {
      // No session and the last attempt failed: keep trying so a transient
      // API blip heals itself instead of stranding the user on a dead-end
      // screen until they think to reload (prod, 2026-08-21).
      if (query.state.status === 'error') return ME_ERROR_RETRY_MS;
      return meHasSyncingMailbox(query.state.data) || meHasDataDeletionInFlight(query.state.data)
        ? ME_SYNC_POLL_MS
        : false;
    },
  });

  useEffect(() => {
    const timezone = browserTimeZone();
    if (!timezone || !query.data || query.data.user.timezone === timezone) return;

    // Best-effort preference healing. A failed request retries naturally on
    // the next auth refetch; it never blocks the app or the UTC fallback.
    void apiPatch<{ timezone: string }>('/api/me/timezone', { timezone })
      .then(() => {
        queryClient.setQueryData<Me>(ME_QUERY_KEY, (current) =>
          current ? { ...current, user: { ...current.user, timezone } } : current,
        );
      })
      .catch(() => undefined);
  }, [query.data, queryClient]);

  return query;
}

/**
 * Hydration-safe IANA timezone for date/time labels rendered into
 * server HTML. Reads the `me` cache without ever fetching: the server
 * pass and the first client render see the same cache entry (or the
 * same absence → 'UTC'), so a label formatted with this zone can never
 * mismatch on hydration (React #418; e2e hydration-smoke). The
 * browser-zone healing in `useMe` keeps the value current after mount.
 */
export function useUserTimeZone(): string {
  const { data } = useQuery({
    ...meQueryOptions(),
    // `enabled: false` — not `skipToken` — carries the never-fetch intent.
    // Both stop THIS observer fetching, but `skipToken` also becomes the
    // shared query's `queryFn` the moment any consumer of this hook
    // re-renders after `AuthProvider` did. `Query.fetch()` only self-heals a
    // FALSY `queryFn`, and `skipToken` is truthy, so the next
    // `invalidateQueries(ME_QUERY_KEY)` — which every action mutation fires
    // to re-read `cleanupRemaining` — rejected with
    // `Missing queryFn: '["auth","me"]'`, took `useMe` to AuthProvider's
    // "Auth check failed." branch, and killed the app until a hard reload
    // (prod, 2026-08-21). `enabled` is read per-observer, never off the
    // shared query, so it cannot disarm anyone else.
    enabled: false,
  });
  return data?.user.timezone ?? 'UTC';
}

export function browserTimeZone(): string | null {
  if (typeof Intl === 'undefined') return null;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
