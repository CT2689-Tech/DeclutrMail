import { queryOptions } from '@tanstack/react-query';

import type { HomeSummary } from './use-home-summary';
import { homeKeys } from './query-keys';

export function homeSummaryQueryOptions(reader: (signal: AbortSignal) => Promise<HomeSummary>) {
  return queryOptions({
    queryKey: homeKeys.summary(),
    queryFn: ({ signal }) => reader(signal),
    staleTime: 30_000,
  });
}
