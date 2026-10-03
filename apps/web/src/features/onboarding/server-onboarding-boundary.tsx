import 'server-only';

import { dehydrate, hydrate, HydrationBoundary, isCancelledError } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  OnboardingFirstTriageMetaSchema,
  type MeSettings,
  type OnboardingState,
  type SyncStatus,
} from '@declutrmail/shared/contracts';

import { autopilotRulesQueryOptions } from '@/features/autopilot/api/query-options';
import { meSettingsQueryOptions } from '@/features/settings/api/query-options';
import type { AutopilotRuleDto } from '@/lib/api/autopilot';
import { ME_QUERY_KEY } from '@/features/auth/api/me-contract';
import { getServerMe, hasServerAccessCookie } from '@/features/auth/api/server-me';
import type { TriageDecisionRow } from '@/features/triage/data';
import { serverGet, serverGetEnvelope } from '@/lib/api/server';
import { makeServerQueryClient, settleServerQueries } from '@/lib/server-query-client';
import {
  FIRST_TRIAGE_KEY,
  ONBOARDING_STATE_KEY,
  firstTriageQueryOptions,
  onboardingStateQueryOptions,
} from './api/query-options';
import type { FirstTriageRead } from './api/use-onboarding';
import { syncStatusQueryKey, syncStatusQueryOptions } from './api/use-sync-status';

/** Seed the authenticated half of onboarding without changing its pre-auth flow. */
export async function ServerOnboardingBoundary({
  cookieHeader,
  children,
}: {
  cookieHeader: string;
  children: ReactNode;
}) {
  const queryClient = makeServerQueryClient();
  // These two user-scoped endpoints authenticate themselves and need no
  // fields from /auth/me. A separate request-local client keeps their earlier
  // deadline from cancelling mailbox reads that can only start after auth.
  const userQueryClient = makeServerQueryClient();
  let discardUserReads = false;
  const userReads = settleServerQueries(
    'onboarding',
    hasServerAccessCookie(cookieHeader)
      ? [
          userQueryClient.fetchQuery(
            onboardingStateQueryOptions((signal) =>
              serverGet<OnboardingState>('/api/onboarding/state', cookieHeader, signal),
            ),
          ),
          // The sync gate's "we'll email you" line reads emailPrefs; seeded here
          // so its first render already shows the right sentence, not a swap.
          userQueryClient.fetchQuery(
            meSettingsQueryOptions((signal) =>
              serverGet<MeSettings>('/api/me/settings', cookieHeader, signal),
            ),
          ),
        ].map((query) =>
          query.catch((error: unknown) => {
            // A failed bootstrap intentionally cancels speculation. It did
            // not hit the deadline and must not inflate timeout telemetry.
            if (discardUserReads && isCancelledError(error)) return;
            throw error;
          }),
        )
      : [],
    userQueryClient,
  );
  const me = await getServerMe(cookieHeader);

  if (me !== null) {
    queryClient.setQueryData(ME_QUERY_KEY, me);
    const queries: Array<Promise<unknown>> = [];
    if (me.activeMailboxId !== null) {
      const mailboxId = me.activeMailboxId;
      queries.push(
        queryClient.fetchQuery(
          syncStatusQueryOptions(mailboxId, (signal) =>
            serverGet<SyncStatus>('/api/v1/sync/status', cookieHeader, signal, { mailboxId }),
          ),
        ),
      );
    }
    await Promise.all([userReads, settleServerQueries('onboarding', queries, queryClient)]);
    hydrate(queryClient, dehydrate(userQueryClient));

    const state = queryClient.getQueryData<OnboardingState>(ONBOARDING_STATE_KEY);
    const activeMailboxId = me.activeMailboxId;
    const sync = activeMailboxId
      ? queryClient.getQueryData<SyncStatus>(syncStatusQueryKey(activeMailboxId))
      : undefined;
    if (state?.onboardedAt === null && activeMailboxId !== null && sync?.is_ready_for_triage) {
      if (state.goal === null || state.presetPicks === null) {
        await settleServerQueries(
          'onboarding-step',
          [
            queryClient.fetchQuery(
              autopilotRulesQueryOptions((signal) =>
                serverGet<AutopilotRuleDto[]>('/api/autopilot/rules', cookieHeader, signal, {
                  mailboxId: activeMailboxId,
                }),
              ),
            ),
          ],
          queryClient,
        );
      } else if (queryClient.getQueryData(FIRST_TRIAGE_KEY) === undefined) {
        await settleServerQueries(
          'onboarding-step',
          [
            queryClient.fetchQuery(
              firstTriageQueryOptions(async (signal): Promise<FirstTriageRead> => {
                const envelope = await serverGetEnvelope<TriageDecisionRow[]>(
                  '/api/onboarding/first-triage',
                  cookieHeader,
                  signal,
                  { mailboxId: activeMailboxId },
                );
                return {
                  rows: envelope.data,
                  meta: OnboardingFirstTriageMetaSchema.parse(envelope.meta),
                };
              }),
            ),
          ],
          queryClient,
        );
      }
    }
  } else {
    // A rejected bootstrap must neither wait for hung speculation nor
    // expose its data. The existing client auth query remains the recovery.
    discardUserReads = true;
    await userQueryClient.cancelQueries();
    await userReads;
  }

  return <HydrationBoundary state={dehydrate(queryClient)}>{children}</HydrationBoundary>;
}
