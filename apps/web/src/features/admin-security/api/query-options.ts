import { infiniteQueryOptions } from '@tanstack/react-query';
import type { PaginatedEnvelope } from '@declutrmail/shared/contracts';

import type { ListSecurityEventsInput, SecurityEventWire } from '@/lib/api/security-events';
import { securityEventsKeys } from './query-keys';

type SecurityEventsReader = (
  cursor: string,
  signal: AbortSignal,
) => Promise<PaginatedEnvelope<SecurityEventWire>>;

export function securityEventsQueryOptions(
  filters: ListSecurityEventsInput,
  reader: SecurityEventsReader,
) {
  return infiniteQueryOptions({
    queryKey: securityEventsKeys.list(filters),
    queryFn: ({ pageParam, signal }) => reader(pageParam, signal),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.meta.pagination.nextCursor ?? undefined,
  });
}
