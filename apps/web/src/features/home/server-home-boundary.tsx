import 'server-only';

import type { ReactNode } from 'react';

import { getServerMe } from '@/features/auth/api/server-me';
import { serverGet } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';
import { homeSummaryQueryOptions } from './api/query-options';
import type { HomeSummary } from './api/use-home-summary';

/**
 * Seed Home's primary summary alongside app-shell hydration, rather than
 * after its HTML and browser JavaScript. The session lookup is request-cached.
 * Review tasks and optional workflow signals are client-owned progressive reads.
 * Their existing destination query keys still share results with navigation.
 */
export async function ServerHomeBoundary({
  cookieHeader,
  children,
}: {
  cookieHeader: string;
  children: ReactNode;
}) {
  const me = await getServerMe(cookieHeader);
  const mailboxId = me?.activeMailboxId ?? undefined;

  return ServerQueryHydration({
    surface: 'home',
    prefetch: (queryClient) => {
      if (me === null || mailboxId === undefined) return [];
      const mailboxOptions = { mailboxId };
      const queries: Array<Promise<unknown>> = [
        queryClient.fetchQuery(
          homeSummaryQueryOptions((signal) =>
            serverGet<HomeSummary>(
              '/api/activity/summary?window=all',
              cookieHeader,
              signal,
              mailboxOptions,
            ),
          ),
        ),
      ];
      return queries;
    },
    children,
  });
}
