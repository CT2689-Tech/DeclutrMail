import { Suspense } from 'react';
import { headers } from 'next/headers';

import { hasServerAccessCookie } from '@/features/auth/api/server-me';
import { senderDetailQueryOptions } from '@/features/senders/api/query-options';
import { SenderDetailRoute } from '@/features/senders/detail/sender-detail-page';
import type { SenderDetailDto } from '@/lib/api/senders';
import { serverGetEnvelope } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';

/**
 * Hydrate identity, counts and action context first. Messages, trend and
 * history are owned by the client's progressive sections, so a slow secondary
 * read cannot hold the whole page and cannot race late server hydration.
 * The API still authenticates and resolves mailbox scope on every read.
 */
export default async function SenderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, requestHeaders] = await Promise.all([params, headers()]);
  const cookieHeader = requestHeaders.get('cookie') ?? '';
  const enabled = hasServerAccessCookie(cookieHeader) && id.length > 0;

  return (
    <ServerQueryHydration
      surface="sender-detail"
      prefetch={(queryClient) =>
        enabled
          ? [
              queryClient.fetchQuery({
                ...senderDetailQueryOptions(id, (signal) =>
                  serverGetEnvelope<SenderDetailDto>(
                    `/api/senders/${encodeURIComponent(id)}`,
                    cookieHeader,
                    signal,
                  ),
                ),
                // The shared browser options carry their own retry predicate,
                // which overrides the server client's default. Server reads
                // must fall back immediately, including guarded 401/404/409s.
                retry: false,
              }),
            ]
          : []
      }
    >
      <Suspense fallback={null}>
        <SenderDetailRoute id={id} />
      </Suspense>
    </ServerQueryHydration>
  );
}
