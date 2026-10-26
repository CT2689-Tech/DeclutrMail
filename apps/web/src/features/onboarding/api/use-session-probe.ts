'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ME_QUERY_KEY, type Me } from '@/features/auth/api/me-contract';
import { ApiError, apiGet } from '@/lib/api/client';

/**
 * The first two onboarding steps are public. Their session read must
 * distinguish a signed-out visitor from an expired protected session:
 * AuthProvider's shared `ME_QUERY_KEY` intentionally redirects on a
 * terminal 401, so this probe uses its own key and suppresses that side
 * effect. A server-seeded identity still gives the authenticated flow an
 * immediate first render.
 */
export function useOnboardingSessionProbe() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['onboarding', 'session-probe'] as const,
    queryFn: async ({ signal }) => {
      const envelope = await apiGet<Me>('/api/auth/me', { signal, suppressAuthRedirect: true });
      return envelope.data;
    },
    initialData: () => queryClient.getQueryData<Me>(ME_QUERY_KEY),
    initialDataUpdatedAt: () => queryClient.getQueryState(ME_QUERY_KEY)?.dataUpdatedAt,
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 401) && failureCount < 2,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    // Keep retrying genuine outages while the error surface promises
    // recovery. A normal anonymous 401 is a settled state, not an outage.
    refetchInterval: (query) =>
      query.state.status === 'error' &&
      !(query.state.error instanceof ApiError && query.state.error.status === 401)
        ? 15_000
        : false,
  });
}
