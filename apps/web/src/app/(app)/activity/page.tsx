// /activity — Activity feed surface (D55-D60). The screen reads from
// `GET /api/activity`; this route prefetches its first page.

import { Suspense } from 'react';
import { headers } from 'next/headers';

import { ActivityScreen } from '@/features/activity/activity-screen';
import {
  readActivityDateFilters,
  readActivityFilters,
  readActivityOutcomeFilters,
} from '@/features/activity/activity-route-filters';
import { activityInfiniteQueryOptions } from '@/features/activity/api/query-options';
import { hasServerAccessCookie } from '@/features/auth/api/server-me';
import {
  activityListPath,
  parseActivityListEnvelope,
  type ActivityRowWire,
} from '@/lib/api/activity';
import { serverGetEnvelope } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';

export const metadata = {
  title: 'Activity — DeclutrMail',
};

/**
 * Suspense boundary required because `ActivityScreen` reads URL state
 * via `useSearchParams()`, which Next.js requires to be wrapped at the
 * route boundary in app-router. The fallback is intentionally minimal
 * (the screen itself ships a richer loading skeleton).
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [requestHeaders, params] = await Promise.all([headers(), searchParams]);
  const cookieHeader = requestHeaders.get('cookie') ?? '';
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') url.set(key, value);
    else if (Array.isArray(value)) value.forEach((item) => url.append(key, item));
  }
  const dates = readActivityDateFilters(url);
  const outcomes = readActivityOutcomeFilters(url);
  const filters = readActivityFilters(url, dates, outcomes);
  const eligible = hasServerAccessCookie(cookieHeader);

  return (
    <ServerQueryHydration
      surface="activity"
      prefetch={(queryClient) => {
        if (!eligible) return [];
        if (dates.isInvalid || outcomes.isInvalid) return [];
        return [
          queryClient.fetchInfiniteQuery(
            activityInfiniteQueryOptions(filters, async (queryFilters, cursor, signal) =>
              parseActivityListEnvelope(
                await serverGetEnvelope<ActivityRowWire[]>(
                  activityListPath({ ...queryFilters, cursor }),
                  cookieHeader,
                  signal,
                ),
              ),
            ),
          ),
        ];
      }}
    >
      <Suspense fallback={null}>
        <ActivityScreen />
      </Suspense>
    </ServerQueryHydration>
  );
}
