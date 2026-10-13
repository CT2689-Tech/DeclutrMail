import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { HomeVisitSummary } from '@declutrmail/shared/contracts/home-visit';
import type { InboxReportDto } from '@declutrmail/shared/inbox-report';

import type { HomeSummary } from './use-home-summary';
import { homeKeys } from './query-keys';

const HOME_READ_STALE_MS = 5 * 60_000;

export function homeSummaryQueryOptions(reader: (signal: AbortSignal) => Promise<HomeSummary>) {
  return queryOptions({
    queryKey: homeKeys.summary(),
    queryFn: ({ signal }) => reader(signal),
    staleTime: 30_000,
  });
}

/** The signed-in Inbox Report. A missing report hides the unsubscribe step. */
export function homeInboxReportQueryOptions(
  mailboxId: string | null,
  reader: (signal: AbortSignal) => Promise<InboxReportDto>,
) {
  return queryOptions({
    queryKey: [...homeKeys.all, 'inbox-report', mailboxId] as const,
    queryFn: ({ signal }) => reader(signal),
    staleTime: HOME_READ_STALE_MS,
    placeholderData: keepPreviousData,
  });
}

/** Arrivals since the last visit. Recording is a separate POST after paint. */
export function homeVisitQueryOptions(
  mailboxId: string | null,
  reader: (signal: AbortSignal) => Promise<HomeVisitSummary>,
) {
  return queryOptions({
    queryKey: homeKeys.visit(mailboxId),
    queryFn: ({ signal }) => reader(signal),
    staleTime: HOME_READ_STALE_MS,
    placeholderData: keepPreviousData,
  });
}
