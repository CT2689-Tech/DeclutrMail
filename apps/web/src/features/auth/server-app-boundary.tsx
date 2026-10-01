import 'server-only';

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { OnboardingState } from '@declutrmail/shared/contracts';

import { onboardingStateQueryOptions } from '@/features/onboarding/api/query-options';
import { serverGet } from '@/lib/api/server';
import { makeServerQueryClient, settleServerQueries } from '@/lib/server-query-client';
import { ME_QUERY_KEY } from './api/me-contract';
import { getServerMe, hasServerAccessCookie } from './api/server-me';

/**
 * Seed the two user-scoped gates together. Both endpoints authenticate the
 * cookie themselves; eligibility is not authentication. Accessory reads
 * (sync, deletion banners, Later recovery, undo, navigation counts) belong
 * to their existing client observers so none can hold every screen's HTML.
 * Route data remains owned by route boundaries.
 */
export async function ServerAppBoundary({
  cookieHeader,
  children,
}: {
  cookieHeader: string;
  children: ReactNode;
}) {
  const queryClient = makeServerQueryClient();
  const gates = settleServerQueries(
    'app-shell',
    hasServerAccessCookie(cookieHeader)
      ? [
          queryClient.fetchQuery(
            onboardingStateQueryOptions((signal) =>
              serverGet<OnboardingState>('/api/onboarding/state', cookieHeader, signal),
            ),
          ),
        ]
      : [],
    queryClient,
  );
  const me = await getServerMe(cookieHeader);
  await gates;
  if (me !== null) queryClient.setQueryData(ME_QUERY_KEY, me);

  return <HydrationBoundary state={dehydrate(queryClient)}>{children}</HydrationBoundary>;
}
