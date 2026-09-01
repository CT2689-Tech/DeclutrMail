/**
 * `useMe` — TanStack Query hook for `GET /api/auth/me`.
 *
 * Drives the AuthProvider + the account menu.
 *
 * REFETCH REALITY (corrected 2026-08-21). For most of this file's life
 * the doc claimed a window-focus refetch that was never configured — the
 * global default in `makeQueryClient` is `false` and nothing overrode it.
 * That lie had consequences twice over: the mutation-side scope-conflict
 * handler cited it as its reason for leaving reads uncovered (the app
 * shell renders the reconnect gate off `me`, so a stale `me` meant the
 * gate never appeared), and it hid the fact that a failed `me` had no
 * route back at all.
 *
 * What is true now: `meQueryOptions` sets `refetchOnWindowFocus: true`
 * for THIS query only — the client-wide default stays `false`, because a
 * focus refetch across every query is a request storm. `me` also polls
 * while a mailbox is syncing or deleting, retries every
 * {@link ME_ERROR_RETRY_MS} while it has no session at all, and a
 * `QueryCache.onError` in `makeQueryClient` resets the scoped cache on a
 * read scope-conflict. Four routes back, where there used to be none.
 */

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SyncReadiness } from '@declutrmail/shared/contracts';
import { apiGet, apiPatch, ApiError } from '@/lib/api/client';
import { ME_QUERY_KEY, type Me } from './me-contract';

export { ME_QUERY_KEY, type Me, type MeMailbox, type MeUser, type Tier } from './me-contract';

/**
 * Readiness values that keep `me` polling — a mailbox here is still
 * syncing, OR has terminally failed and may recover without a page
 * reload (a retry, or the server-side `cursorTooOld` recovery).
 *
 * QA-sync-20260831-05: this widens the ORIGINAL `['queued', 'syncing']`
 * set with `'failed'`. It does not close the full gap — a mailbox that
 * is already `ready` and silently transitions server-side (e.g. a
 * reconnect re-queues it) is still not observed until the next window
 * focus, because nothing is polling while every mailbox reads `ready`.
 * Fixing that fully means either polling permanently at low frequency or
 * reading `/sync/status` (which DOES poll at `ready`) instead of `me` for
 * every readiness-derived surface — a bigger cost/architecture call left
 * for the founder, not made here. What this DOES fix: once any mailbox
 * is known to be `failed`, the poll keeps running, so a subsequent
 * recovery (retry succeeds, or a second failure) is observed promptly
 * instead of only on the next manual reload or window focus.
 */
const SYNCING_READINESS: ReadonlyArray<SyncReadiness> = ['queued', 'syncing', 'failed'];

/** Poll cadence for `me` while a mailbox's initial sync is in flight. */
export const ME_SYNC_POLL_MS = 4_000;

/** True when any active mailbox is still doing its initial sync, or has failed and may recover. */
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
 * While any mailbox is `queued`/`syncing` (e.g. a freshly-connected second
 * account), `me` polls every {@link ME_SYNC_POLL_MS} so the account
 * switcher's "Syncing…→Ready" badge + the ready toast update without a
 * manual refresh (D116). `failed` is ALSO in that set (QA-sync-20260831-05)
 * — deliberately, so the toast + every surface reading `readiness` off
 * `me` can still notice a later recovery — which means polling does NOT
 * stop once a mailbox reaches `failed`: nothing re-queues it
 * automatically, so this keeps polling indefinitely until the user acts
 * (retries, reconnects) or disconnects the mailbox. A pre-existing,
 * separate gap (design-system-agent review): this only starts polling
 * again once `me` has ALREADY observed the failure — a `ready→failed`
 * transition while every cached mailbox reads `ready` still isn't
 * caught without a manual refresh/focus.
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
