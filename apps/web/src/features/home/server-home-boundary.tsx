import 'server-only';

import type { ReactNode } from 'react';
import type { HomeVisitSummary } from '@declutrmail/shared/contracts/home-visit';
import type { InboxReportDto } from '@declutrmail/shared/inbox-report';

import { getServerMe } from '@/features/auth/api/server-me';
import { serverGet } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';
import { readHomeVisitCookie } from './api/home-visit-cookie';
import {
  homeInboxReportQueryOptions,
  homeSummaryQueryOptions,
  homeVisitQueryOptions,
} from './api/query-options';
import type { HomeSummary } from './api/use-home-summary';

/**
 * Seed Home's summary, visit peek, and Inbox Report alongside app-shell
 * hydration, rather than after its HTML and browser JavaScript. The
 * session lookup is request-cached. Recording the visit stays client-side
 * after first paint so the peek is not replaced mid-render.
 * Review tasks and optional workflow signals are client-owned progressive reads.
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
      const visitId = readHomeVisitCookie(cookieHeader, mailboxId);
      const reads: Promise<unknown>[] = [
        queryClient.fetchQuery(
          homeSummaryQueryOptions(
            (signal) =>
              serverGet<HomeSummary>(
                '/api/activity/summary?window=all',
                cookieHeader,
                signal,
                mailboxOptions,
              ),
            mailboxId,
          ),
        ),
        queryClient.fetchQuery(
          homeInboxReportQueryOptions(mailboxId, (signal) =>
            serverGet<InboxReportDto>(
              `/api/mailboxes/${mailboxId}/inbox-report`,
              cookieHeader,
              signal,
              mailboxOptions,
            ),
          ),
        ),
      ];
      // Peek only when this visit is already known. A no-cookie compute
      // would dehydrate a new window and the same-mailbox placeholder would
      // hide the stored one after a reload.
      if (visitId !== null) {
        reads.push(
          queryClient.fetchQuery(
            homeVisitQueryOptions(mailboxId, (signal) =>
              serverGet<HomeVisitSummary>(
                `/api/home/visit?visitId=${encodeURIComponent(visitId)}`,
                cookieHeader,
                signal,
                mailboxOptions,
              ),
            ),
          ),
        );
      }
      return reads;
    },
    children,
  });
}
