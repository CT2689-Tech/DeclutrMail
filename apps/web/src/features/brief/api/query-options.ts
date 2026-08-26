import { queryOptions } from '@tanstack/react-query';
import type { Envelope } from '@declutrmail/shared/contracts';

import type { BriefWire } from '@/lib/api/brief';
import { briefKeys } from './query-keys';

type BriefReader = (signal: AbortSignal) => Promise<Envelope<BriefWire, unknown>>;
type BriefHistoryReader = (
  from: string,
  to: string,
  signal: AbortSignal,
) => Promise<Envelope<BriefWire[], unknown>>;

export function briefTodayQueryOptions(reader: BriefReader) {
  return queryOptions({
    queryKey: briefKeys.today(),
    queryFn: ({ signal }) => reader(signal),
  });
}

/**
 * Past Briefs in a date range. D69 freezes each snapshot once written,
 * so this data cannot change after the fact — a long `staleTime` keeps
 * a day's browsing to one request instead of one per selection.
 */
export function briefHistoryQueryOptions(reader: BriefHistoryReader, from: string, to: string) {
  return queryOptions({
    queryKey: briefKeys.history(from, to),
    queryFn: ({ signal }) => reader(from, to, signal),
    staleTime: 60 * 60 * 1000,
  });
}
