import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { Envelope, LaterReturnRecoverySummary } from '@declutrmail/shared/contracts';

import type { SnoozedSenderRow } from '@/lib/api/snoozed';
import { snoozedKeys } from './query-keys';

type SnoozedReader<T> = (signal: AbortSignal) => Promise<T>;

export function snoozedListQueryOptions(
  reader: SnoozedReader<Envelope<SnoozedSenderRow[], unknown>>,
) {
  return queryOptions({
    queryKey: snoozedKeys.list(),
    queryFn: ({ signal }) => reader(signal),
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function laterRecoveryQueryOptions(
  reader: SnoozedReader<Envelope<LaterReturnRecoverySummary, unknown>>,
) {
  return queryOptions({
    queryKey: snoozedKeys.recovery(),
    queryFn: ({ signal }) => reader(signal),
    // Off so a dropped fetch is not retried again on top of the client's
    // GET retries. The interval stays a number so a hidden tab resumes.
    retry: false,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}
