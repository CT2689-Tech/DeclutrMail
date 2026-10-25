import { queryOptions, type PlaceholderDataFunction } from '@tanstack/react-query';
import type { HomeVisitSummary } from '@declutrmail/shared/contracts/home-visit';
import type { InboxReportDto } from '@declutrmail/shared/inbox-report';

import type { HomeSummary } from './use-home-summary';
import { homeKeys } from './query-keys';

const HOME_READ_STALE_MS = 5 * 60_000;

/**
 * Keep the last result across a refetch of the SAME mailbox. A new mailbox
 * key must stay pending — `keepPreviousData` would paint the previous
 * mailbox's report and visit line until the next response landed.
 */
function placeholderForMailbox<T>(mailboxId: string | null): PlaceholderDataFunction<T> {
  return (previousData, previousQuery) => {
    if (previousData === undefined || previousQuery === undefined) return undefined;
    return previousQuery.queryKey.at(-1) === mailboxId ? previousData : undefined;
  };
}

export function homeSummaryQueryOptions(
  reader: (signal: AbortSignal) => Promise<HomeSummary>,
  mailboxId?: string,
) {
  return queryOptions({
    queryKey: homeKeys.summary(mailboxId),
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
    placeholderData: placeholderForMailbox<InboxReportDto>(mailboxId),
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
    placeholderData: placeholderForMailbox<HomeVisitSummary>(mailboxId),
  });
}
