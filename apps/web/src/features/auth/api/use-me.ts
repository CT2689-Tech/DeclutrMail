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
    queryKey: ME_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const envelope = await apiGet<Me>('/api/auth/me', { signal });
      return envelope.data;
    },
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 401) return false;
      return failureCount < 2;
    },
    staleTime: 60_000,
    refetchInterval: (query) =>
      meHasSyncingMailbox(query.state.data) || meHasDataDeletionInFlight(query.state.data)
        ? ME_SYNC_POLL_MS
        : false,
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
  const { data } = useQuery<Me>({
    queryKey: ME_QUERY_KEY,
    enabled: false,
    staleTime: Infinity,
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
