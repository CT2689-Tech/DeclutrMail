import { queryOptions } from '@tanstack/react-query';
import type { Envelope } from '@declutrmail/shared/contracts';

import type { BriefWire } from '@/lib/api/brief';
import { briefKeys } from './query-keys';

type BriefReader = (signal: AbortSignal) => Promise<Envelope<BriefWire, unknown>>;

export function briefTodayQueryOptions(reader: BriefReader) {
  return queryOptions({
    queryKey: briefKeys.today(),
    queryFn: ({ signal }) => reader(signal),
  });
}
