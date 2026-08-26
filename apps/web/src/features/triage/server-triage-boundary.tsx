import 'server-only';

import type { ReactNode } from 'react';

import { serverGet } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';
import { meSettingsQueryOptions } from '@/features/settings/api/query-options';
import { TODAY_SUMMARY_KEY, TRIAGE_QUEUE_KEY, TRIAGE_STATS_KEY } from './api/query-options';
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
    prefetch: (queryClient) => {
      if (!enabled) return [];
      const serverBootstrapKey = ['triage', 'server-bootstrap'] as const;
      const bootstrap = queryClient
        .fetchQuery({
          queryKey: serverBootstrapKey,
          queryFn: ({ signal }) =>
            serverGet<{
              queue: TriageDecisionRow[];
              stats: TriageSessionStats;
              todaySummary: TodaySummary;
            }>('/api/triage/bootstrap', cookieHeader, signal),
        })
        .then((data) => {
          queryClient.setQueryData(TRIAGE_QUEUE_KEY, data.queue);
          queryClient.setQueryData(TRIAGE_STATS_KEY, data.stats);
          queryClient.setQueryData(TODAY_SUMMARY_KEY, data.todaySummary);
          // The bootstrap is a transport shape, not client state. Removing
          // it avoids serializing a second copy of the same three payloads
          // into the RSC hydration response.
          queryClient.removeQueries({ queryKey: serverBootstrapKey, exact: true });
        });
      return [
        bootstrap,
        queryClient.fetchQuery(
          meSettingsQueryOptions((signal) =>
            serverGet<MeSettings>('/api/me/settings', cookieHeader, signal),
          ),
        ),
      ];
    },
    children,
  });
}
