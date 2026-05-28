/**
 * `useMe` — TanStack Query hook for `GET /api/auth/me`.
 *
 * Drives the AuthProvider + the account menu. The query is loaded once
 * at app mount and re-fetched on window focus so a session revoked in
 * another tab surfaces as a 401 (which the apiClient routes to the
 * login redirect).
 */

import { useQuery } from '@tanstack/react-query';
import type { SyncReadiness } from '@declutrmail/shared/contracts';
import { apiGet, ApiError } from '@/lib/api/client';

export type Tier = 'free' | 'plus' | 'pro';

export interface MeUser {
  id: string;
  email: string;
  workspaceId: string;
}

export interface MeMailbox {
  id: string;
  email: string;
  status: 'active' | 'disconnected';
  connectedAt: string | null;
  /** Initial-sync readiness; `null` until the first sync row exists (D116). */
  readiness: SyncReadiness | null;
}

export interface Me {
  user: MeUser;
  mailboxes: MeMailbox[];
  activeMailboxId: string | null;
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
  return useQuery({
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
    refetchInterval: (query) => (meHasSyncingMailbox(query.state.data) ? ME_SYNC_POLL_MS : false),
  });
}
