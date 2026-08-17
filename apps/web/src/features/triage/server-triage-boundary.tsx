import 'server-only';

import type { ReactNode } from 'react';

import { serverGet } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';
import { meSettingsQueryOptions } from '@/features/settings/api/query-options';
import {
  todaySummaryQueryOptions,
  triageQueueQueryOptions,
  triageStatsQueryOptions,
} from './api/query-options';
import type { MeSettings } from '@declutrmail/shared/contracts';
import type { TodaySummary } from './api/use-triage-queue';
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
  return ServerQueryHydration({
    surface: 'triage',
    prefetch: (queryClient) =>
      enabled
        ? [
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
            queryClient.fetchQuery(
              todaySummaryQueryOptions((signal) =>
                serverGet<TodaySummary>('/api/triage/today-summary', cookieHeader, signal),
              ),
            ),
            queryClient.fetchQuery(
              meSettingsQueryOptions((signal) =>
                serverGet<MeSettings>('/api/me/settings', cookieHeader, signal),
              ),
            ),
          ]
        : [],
    children,
  });
}
