import { queryOptions } from '@tanstack/react-query';
import type { UndoTrayEntry } from '@declutrmail/shared';

import { undoKeys } from './query-keys';

type UndoEntriesReader = (signal: AbortSignal) => Promise<UndoTrayEntry[]>;

export function undoEntriesQueryOptions(mailboxId: string | undefined, reader: UndoEntriesReader) {
  return queryOptions({
    queryKey: undoKeys.tray(mailboxId),
    queryFn: ({ signal }) => reader(signal),
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}
