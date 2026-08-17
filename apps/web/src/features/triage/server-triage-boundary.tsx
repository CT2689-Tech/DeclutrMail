import 'server-only';

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { serverGet } from '@/lib/api/server';
import { makeServerQueryClient, settleServerQueries } from '@/lib/server-query-client';
import { triageQueueQueryOptions, triageStatsQueryOptions } from './api/query-options';
import type { TriageDecisionRow, TriageSessionStats } from './data';

export async function ServerTriageBoundary({
  cookieHeader,
  enabled,
  children,
}: {
  cookieHeader: string;
  enabled: boolean;
  children: ReactNode;
}) {
  const queryClient = makeServerQueryClient();

  if (enabled) {
    await settleServerQueries('triage', [
      queryClient.fetchQuery(
        triageQueueQueryOptions((signal) =>
          serverGet<TriageDecisionRow[]>('/api/triage/queue', cookieHeader, signal),
        ),
      ),
      queryClient.fetchQuery(
        triageStatsQueryOptions((signal) =>
          serverGet<TriageSessionStats>('/api/triage/stats', cookieHeader, signal),
        ),
      ),
    ]);
  }

  return <HydrationBoundary state={dehydrate(queryClient)}>{children}</HydrationBoundary>;
}
