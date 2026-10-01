import 'server-only';

import type { ReactNode } from 'react';
import { hasCapability } from '@declutrmail/shared/entitlements';

import { getServerMe } from '@/features/auth/api/server-me';
import { screenerCountQueryOptions } from '@/features/screener/api/query-options';
import {
  triageBootstrapQueryOptions,
  type TriageBootstrap,
} from '@/features/triage/api/query-options';
import { serverGet } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';
import { homeSummaryQueryOptions } from './api/query-options';
import type { HomeSummary } from './api/use-home-summary';

/**
 * Start Home's critical reads alongside app-shell hydration, rather than
 * after its HTML and browser JavaScript. The session lookup is request-cached.
 * Reuse destination query keys so Home and navigation badges share results;
 * optional workflow signals remain client-owned and never delay this boundary.
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
      const tier = me.tier ?? 'free';
      if (hasCapability(tier, 'triage')) {
        queries.push(
          queryClient.fetchQuery(
            triageBootstrapQueryOptions((signal) =>
              serverGet<TriageBootstrap>(
                '/api/triage/bootstrap',
                cookieHeader,
                signal,
                mailboxOptions,
              ),
            ),
          ),
        );
      }
      if (hasCapability(tier, 'screener')) {
        queries.push(
          queryClient.fetchQuery(
            screenerCountQueryOptions((signal) =>
              serverGet<{ pending: number }>(
                '/api/screener/count',
                cookieHeader,
                signal,
                mailboxOptions,
              ),
            ),
          ),
        );
      }
      return queries;
    },
    children,
  });
}
