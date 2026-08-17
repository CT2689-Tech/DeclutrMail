import { queryOptions } from '@tanstack/react-query';
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
  });
}

export function laterRecoveryQueryOptions(
  reader: SnoozedReader<Envelope<LaterReturnRecoverySummary, unknown>>,
) {
  return queryOptions({
    queryKey: snoozedKeys.recovery(),
    queryFn: ({ signal }) => reader(signal),
    retry: false,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
