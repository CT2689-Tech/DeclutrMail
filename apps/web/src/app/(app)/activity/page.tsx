// /activity — Activity feed surface (D55-D60, tracer-bullet).
//
// Backend ActivityModule shipped in this PR; the screen reads from
// `GET /api/activity?window=&source=&cursor=`. D57 row expansion + D60
// mobile-specific layout + per-sender feed + D58 undo wire-up land in
// follow-up PRs — see PR body for the deferred scope.

import { Suspense } from 'react';
import { headers } from 'next/headers';

import { ActivityScreen } from '@/features/activity/activity-screen';
import {
  readActivityDateFilters,
  readActivityFilters,
  readActivityOutcomeFilters,
} from '@/features/activity/activity-route-filters';
import {
  activityInfiniteQueryOptions,
  activityWeeklyReviewQueryOptions,
} from '@/features/activity/api/query-options';
import { getServerMe } from '@/features/auth/api/server-me';
import {
  activityListPath,
  parseActivityListEnvelope,
  type ActivityRowWire,
  type ActivityWeeklyReviewWire,
} from '@/lib/api/activity';
import { serverGet, serverGetEnvelope } from '@/lib/api/server';
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
  const me = await getServerMe(cookieHeader);
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') url.set(key, value);
    else if (Array.isArray(value)) value.forEach((item) => url.append(key, item));
  }
  const dates = readActivityDateFilters(url);
  const outcomes = readActivityOutcomeFilters(url);
  const filters = readActivityFilters(url, dates, outcomes);
  const eligible = me?.activeMailboxId != null;

  return (
    <ServerQueryHydration
      surface="activity"
      prefetch={(queryClient) => {
        if (!eligible) return [];
        const queries: Array<Promise<unknown>> = [
          queryClient.fetchQuery(
            activityWeeklyReviewQueryOptions((signal) =>
              serverGet<ActivityWeeklyReviewWire>(
                '/api/activity/weekly-review',
                cookieHeader,
                signal,
              ),
            ),
          ),
        ];
        if (!dates.isInvalid && !outcomes.isInvalid) {
          queries.push(
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
          );
        }
        return queries;
      }}
    >
      <Suspense fallback={null}>
        <ActivityScreen />
      </Suspense>
    </ServerQueryHydration>
  );
}
