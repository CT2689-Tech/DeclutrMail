import type { QueryClient } from '@tanstack/react-query';
import type { fetchSenderDetail, SenderListEnvelope } from '@/lib/api/senders';
import { canPerformSenderAction, type ActionVerb, type Sender } from '../data';
import { sendersKeys } from './query-keys';

/** Revalidate an open list confirmation before the query observer commits its render. */
export function currentListActionSender(
  qc: QueryClient,
  key: ReturnType<typeof sendersKeys.list>,
  subject: Sender,
  verb: ActionVerb,
): Sender | null {
  const list = qc.getQueryState<{ pages: SenderListEnvelope[] }>(key);
  const listed =
    list?.status === 'success' && !list.isInvalidated
      ? list.data?.pages.flatMap((page) => page.data).find((row) => row.id === subject.id)
      : undefined;
  let current = listed ? { ...subject, ...listed } : null;
  let readAt = listed ? list!.dataUpdatedAt : 0;
  for (const [detailKey, detail] of qc.getQueriesData<
    Awaited<ReturnType<typeof fetchSenderDetail>>
  >({
    queryKey: sendersKeys.detail(subject.id),
    predicate: (query) => query.queryKey.length === 3 || query.queryKey[3] === 'cleanup',
  })) {
    const state = qc.getQueryState(detailKey);
    if (
      detail &&
      state?.status === 'success' &&
      !state.isInvalidated &&
      (state.dataUpdatedAt > readAt ||
        (state.dataUpdatedAt === readAt &&
          !canPerformSenderAction(verb, { ...subject, ...detail.data })))
    ) {
      current = { ...subject, ...detail.data };
      readAt = state.dataUpdatedAt;
    }
  }
  return current;
}
