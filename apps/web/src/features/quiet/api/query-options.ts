import { queryOptions } from '@tanstack/react-query';
import type { QuietHoursState } from '@declutrmail/shared/contracts';

import { quietKeys } from './query-keys';

type QuietHoursReader = (signal: AbortSignal) => Promise<QuietHoursState>;

export function quietHoursQueryOptions(mailboxId: string, reader: QuietHoursReader) {
  return queryOptions({
    queryKey: quietKeys.hours(mailboxId),
    queryFn: ({ signal }) => reader(signal),
    // `activeNow` and `heldCount` are a point-in-time read with no other
    // trigger to refresh them (no refetchOnWindowFocus; only the save PUT
    // invalidates this key) — without a poll, an open tab keeps showing a
    // window as active, and its count as current, long after it ended.
    refetchInterval: 60_000,
  });
}
