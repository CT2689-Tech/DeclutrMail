import 'server-only';

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  AccountDeletionStatus,
  LaterReturnRecoverySummary,
  OnboardingState,
  SyncStatus,
} from '@declutrmail/shared/contracts';
import type { UndoTrayEntry } from '@declutrmail/shared';

import { accountDeletionQueryOptions } from '@/features/account-deletion/api/query-options';
import { onboardingStateQueryOptions } from '@/features/onboarding/api/query-options';
import { syncStatusQueryOptions } from '@/features/onboarding/api/use-sync-status';
import { laterRecoveryQueryOptions } from '@/features/snoozed/api/query-options';
import { undoEntriesQueryOptions } from '@/features/undo/query-options';
import { serverGet, serverGetEnvelope } from '@/lib/api/server';
import { makeServerQueryClient, settleServerQueries } from '@/lib/server-query-client';
import { ME_QUERY_KEY } from './api/me-contract';
import { getServerMe } from './api/server-me';

/**
 * One outer hydration owner for reads mounted by authenticated app chrome.
 *
 * Keeping these entries outside route-level boundaries prevents a client
 * observer in `AppChrome` from racing a nested route stream. All eligible
 * reads start together after the cached auth lookup; route data renders
 * independently and remains owned by route boundaries.
 */
export async function ServerAppBoundary({
  cookieHeader,
  children,
}: {
  cookieHeader: string;
  children: ReactNode;
}) {
  const queryClient = makeServerQueryClient();
  const me = await getServerMe(cookieHeader);

  if (me !== null) {
    queryClient.setQueryData(ME_QUERY_KEY, me);
    const queries: Array<Promise<unknown>> = [
      queryClient.fetchQuery(
        onboardingStateQueryOptions((signal) =>
          serverGet<OnboardingState>('/api/onboarding/state', cookieHeader, signal),
        ),
      ),
      queryClient.fetchQuery(
        accountDeletionQueryOptions((signal) =>
          serverGet<AccountDeletionStatus>('/api/account/deletion', cookieHeader, signal),
        ),
      ),
    ];

    const mailboxId = me.activeMailboxId ?? undefined;
    if (mailboxId !== undefined) {
      const mailboxOptions = { mailboxId };
      queries.push(
        queryClient.fetchQuery(
          syncStatusQueryOptions(mailboxId, (signal) =>
            serverGet<SyncStatus>('/api/v1/sync/status', cookieHeader, signal, mailboxOptions),
          ),
        ),
        queryClient.fetchQuery(
          laterRecoveryQueryOptions((signal) =>
            serverGetEnvelope<LaterReturnRecoverySummary>(
              '/api/snoozed/recovery',
              cookieHeader,
              signal,
              mailboxOptions,
            ),
          ),
        ),
        queryClient.fetchQuery(
          undoEntriesQueryOptions(mailboxId, (signal) =>
            serverGet<UndoTrayEntry[]>('/api/undo', cookieHeader, signal, mailboxOptions),
          ),
        ),
      );

      // Counts are optional navigation decoration. Their existing client
      // observers own these reads after hydration, so a slow badge cannot
      // delay the app and there is no competing late hydration/refetch.
    }

    await settleServerQueries('app-shell', queries, queryClient);
  }

  return <HydrationBoundary state={dehydrate(queryClient)}>{children}</HydrationBoundary>;
}
