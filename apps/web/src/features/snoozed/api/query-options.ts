import { queryOptions } from '@tanstack/react-query';
import type { Envelope, LaterReturnRecoverySummary } from '@declutrmail/shared/contracts';

import { backgroundRefetchInterval } from '@/lib/api/background-poll';
import { retryTransientOnly } from '@/lib/api/retry';
import type { SnoozedSenderRow } from '@/lib/api/snoozed';
import { snoozedKeys } from './query-keys';

type SnoozedReader<T> = (signal: AbortSignal) => Promise<T>;

export function snoozedListQueryOptions(
  reader: SnoozedReader<Envelope<SnoozedSenderRow[], unknown>>,
) {
  return queryOptions({
    queryKey: snoozedKeys.list(),
    queryFn: ({ signal }) => reader(signal),
  });
}

export function laterRecoveryQueryOptions(
  reader: SnoozedReader<Envelope<LaterReturnRecoverySummary, unknown>>,
) {
  return queryOptions({
    queryKey: snoozedKeys.recovery(),
    queryFn: ({ signal }) => reader(signal),
    retry: retryTransientOnly,
    refetchInterval: () => backgroundRefetchInterval(60_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}
