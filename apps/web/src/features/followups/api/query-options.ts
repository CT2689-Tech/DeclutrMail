import { queryOptions } from '@tanstack/react-query';
import type { Envelope } from '@declutrmail/shared/contracts';

import type { FollowupRow } from '@/lib/api/followups';
import { followupsKeys } from './query-keys';

type FollowupsReader = (signal: AbortSignal) => Promise<Envelope<FollowupRow[], unknown>>;

export function followupsQueryOptions(reader: FollowupsReader) {
  return queryOptions({
    queryKey: followupsKeys.list(),
    queryFn: ({ signal }) => reader(signal),
  });
}
