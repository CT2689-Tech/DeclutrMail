import { infiniteQueryOptions } from '@tanstack/react-query';
import type { Envelope } from '@declutrmail/shared/contracts';

import type { ActivityFilters, ActivityListMetaWire, ActivityRowWire } from '@/lib/api/activity';
import { activityKeys } from './query-keys';

export type ActivityPage = Envelope<ActivityRowWire[], ActivityListMetaWire>;
type ActivityReader = (
  filters: ActivityFilters,
  cursor: string | undefined,
  signal: AbortSignal,
) => Promise<ActivityPage>;

export function activityInfiniteQueryOptions(filters: ActivityFilters, reader: ActivityReader) {
  return infiniteQueryOptions({
    queryKey: activityKeys.list(filters),
    queryFn: ({ pageParam, signal }) => reader(filters, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.meta?.pagination.nextCursor ?? undefined,
  });
}
