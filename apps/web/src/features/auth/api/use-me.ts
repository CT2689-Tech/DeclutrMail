/**
 * `useMe` — TanStack Query hook for `GET /api/auth/me`.
 *
 * Drives the AuthProvider + the account menu. The query is loaded once
 * at app mount and re-fetched on window focus so a session revoked in
 * another tab surfaces as a 401 (which the apiClient routes to the
 * login redirect).
 */

import { useQuery } from '@tanstack/react-query';
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
}

export interface Me {
  user: MeUser;
  mailboxes: MeMailbox[];
  activeMailboxId: string | null;
}

export const ME_QUERY_KEY = ['auth', 'me'] as const;

/**
 * Returns the authenticated identity + connected mailboxes, or `null`
 * data + `error` set to an ApiError(401) when the session is missing.
 * `retry: false` so the unauthenticated state surfaces immediately
 * instead of looping.
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
  });
}
