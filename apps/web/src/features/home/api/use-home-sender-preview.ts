import { useQueries } from '@tanstack/react-query';
import { homeKeys } from './query-keys';
import { apiGet } from '@/lib/api/client';
import type { SenderDetailDto } from '@/lib/api/senders';
import type { HomeSenderIdentity } from '../home-next-steps';

/** Optional identities from the exact recommendation; never delays the next action. */
export function useHomeSenderPreview(
  mailboxId: string | null,
  senderIds: readonly string[],
  enabled: boolean,
): HomeSenderIdentity[] {
  const ids = enabled && mailboxId ? [...new Set(senderIds)].slice(0, 3) : [];
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: homeKeys.senderPreview(mailboxId, id),
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const { data } = await apiGet<SenderDetailDto>(`/api/senders/${encodeURIComponent(id)}`, {
          mailboxId: mailboxId!,
          signal,
        });
        const name = data.displayName?.trim() || data.domain?.trim();
        if (data.id !== id || !name || data.protectionFlags?.isProtected) return null;
        return { id, name, domain: data.domain, brandMark: data.brandMark === true };
      },
      // Optional names must not hold shared cleanup/Undo reconciliation open.
      retry: false,
      staleTime: 5 * 60_000,
    })),
  });
  return queries.flatMap((query) => (query.data ? [query.data] : []));
}
