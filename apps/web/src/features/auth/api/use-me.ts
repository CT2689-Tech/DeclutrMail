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
import type {
  MailboxDataDeletionView,
  MailboxIndexedDataState,
  SyncReadiness,
} from '@declutrmail/shared/contracts';
import type { TierId } from '@declutrmail/shared/entitlements';
import { apiGet, apiPatch, ApiError } from '@/lib/api/client';

/**
 * Workspace billing tier as served by `/api/auth/me` (D19). The full
 * 5-row ladder — team/enterprise rank AT pro for feature gates (see
 * `satisfiesActionTier` in `@declutrmail/shared/entitlements`).
 */
export type Tier = TierId;

export interface MeUser {
  id: string;
  email: string;
  workspaceId: string;
  /** IANA timezone used for local Brief generation; null until captured. */
  timezone: string | null;
}

export interface MeMailbox {
  id: string;
  email: string;
  status: 'active' | 'disconnected';
  connectedAt: string | null;
  /** Initial-sync readiness; `null` until the first sync row exists (D116). */
  readiness: SyncReadiness | null;
  /**
   * D245 local-data lifecycle. Optional during the rolling API/web deploy;
   * callers treat an omitted active mailbox as indexed and an omitted
   * disconnected mailbox as retained.
   */
  indexedDataState?: MailboxIndexedDataState;
  /** Latest in-flight/completed indexed-data deletion request, when any. */
  dataDeletion?: MailboxDataDeletionView | null;
}

export interface Me {
  user: MeUser;
  mailboxes: MeMailbox[];
  activeMailboxId: string | null;
  /** Workspace billing tier (D19) — drives every FE entitlement gate. */
  tier: Tier;
  /**
   * Free-tier LIFETIME cleanup actions left (D19: 5); `null` =
   * unlimited (every paid tier). Refreshed with the `me` query, so a
   * `FREE_CAP_REACHED` 402's `details` is the fresher signal mid-flow.
   */
  cleanupRemaining: number | null;
}

export const ME_QUERY_KEY = ['auth', 'me'] as const;

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

export function browserTimeZone(): string | null {
  if (typeof Intl === 'undefined') return null;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
