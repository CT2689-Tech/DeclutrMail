import { queryOptions } from '@tanstack/react-query';
import type { QuietHoursState } from '@declutrmail/shared/contracts';

import { quietKeys } from './query-keys';

type QuietHoursReader = (signal: AbortSignal) => Promise<QuietHoursState>;

export function quietHoursQueryOptions(mailboxId: string, reader: QuietHoursReader) {
  return queryOptions({
    queryKey: quietKeys.hours(mailboxId),
    queryFn: ({ signal }) => reader(signal),
  });
}
