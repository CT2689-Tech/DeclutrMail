import { queryOptions } from '@tanstack/react-query';
import type { UndoTrayEntry } from '@declutrmail/shared';

import { undoKeys } from './query-keys';

/** A `GET /api/undo` decision, as the wire sends it. */
export type UndoWireEntry = UndoTrayEntry & {
  /**
   * Senders this decision skipped because they were Protected when their
   * job ran (D245). Optional on the wire: web and API deploy separately.
   */
  protectedSkippedCount?: number;
};

type UndoEntriesReader = (signal: AbortSignal) => Promise<UndoWireEntry[]>;

export function undoEntriesQueryOptions(mailboxId: string | undefined, reader: UndoEntriesReader) {
  return queryOptions({
    queryKey: undoKeys.tray(mailboxId),
    queryFn: ({ signal }) => reader(signal),
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}
