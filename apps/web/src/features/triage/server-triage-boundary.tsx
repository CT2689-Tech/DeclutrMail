import 'server-only';

import type { ReactNode } from 'react';

import { serverGet } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';
import { meSettingsQueryOptions } from '@/features/settings/api/query-options';
import { TRIAGE_BOOTSTRAP_KEY, type TriageBootstrap } from './api/query-options';
import type { MeSettings } from '@declutrmail/shared/contracts';

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
      // Prefetch straight INTO the key the client reads. The bootstrap used
      // to land under a throwaway key and be fanned out into three, which
      // meant the first paint was consistent and every refetch after it was
      // three independent requests that could disagree. One key, one entry.
      const bootstrap = queryClient.fetchQuery({
        queryKey: TRIAGE_BOOTSTRAP_KEY,
        queryFn: ({ signal }) =>
          serverGet<TriageBootstrap>('/api/triage/bootstrap', cookieHeader, signal),
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
