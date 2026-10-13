import { queryOptions } from '@tanstack/react-query';
import type { InboxReportDto } from '@declutrmail/shared/inbox-report';

import type { HomeSummary } from './use-home-summary';
import { homeKeys } from './query-keys';

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
    staleTime: 30_000,
  });
}
