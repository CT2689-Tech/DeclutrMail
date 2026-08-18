import { Suspense } from 'react';
import { headers } from 'next/headers';
import type { Envelope, PaginatedEnvelope } from '@declutrmail/shared/contracts';

import { getServerMe } from '@/features/auth/api/server-me';
import {
  senderDetailQueryOptions,
  senderHistoryQueryOptions,
  senderMessagesQueryOptions,
  senderTimeseriesQueryOptions,
} from '@/features/senders/api/query-options';
import { SenderDetailRoute } from '@/features/senders/detail/sender-detail-page';
import type {
  DecisionHistoryRowDto,
  MailMessageRow,
  SenderDetailDto,
  TimeseriesPointDto,
} from '@/lib/api/senders';
import { serverGetEnvelope } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';

/**
 * Sender Detail route — `/senders/:id`.
 *
 * The client route owns interaction state; this server entry hydrates its
 * four independent first-page reads in parallel under the exact sender id.
 */
export default async function SenderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, requestHeaders] = await Promise.all([params, headers()]);
  const cookieHeader = requestHeaders.get('cookie') ?? '';
  const me = await getServerMe(cookieHeader);
  const enabled = me?.activeMailboxId != null && id.length > 0;
  const encodedId = encodeURIComponent(id);
  const pagedPath = (resource: 'messages' | 'history', cursor?: string) => {
    const query = new URLSearchParams();
    if (cursor) query.set('cursor', cursor);
    const suffix = query.toString();
    return `/api/senders/${encodedId}/${resource}${suffix ? `?${suffix}` : ''}`;
  };

  return (
    <ServerQueryHydration
      surface="sender-detail"
      prefetch={(queryClient) =>
        enabled
          ? [
              queryClient.fetchQuery(
                senderDetailQueryOptions(id, (signal) =>
                  serverGetEnvelope<SenderDetailDto>(
                    `/api/senders/${encodedId}`,
                    cookieHeader,
                    signal,
                  ),
                ),
              ),
              queryClient.fetchInfiniteQuery(
                senderMessagesQueryOptions(
                  id,
                  async (cursor, signal) =>
                    serverGetEnvelope<MailMessageRow[], PaginatedEnvelope<MailMessageRow>['meta']>(
                      pagedPath('messages', cursor),
                      cookieHeader,
                      signal,
                    ) as Promise<PaginatedEnvelope<MailMessageRow>>,
                ),
              ),
              queryClient.fetchQuery(
                senderTimeseriesQueryOptions(
                  id,
                  (signal) =>
                    serverGetEnvelope<TimeseriesPointDto[]>(
                      `/api/senders/${encodedId}/timeseries`,
                      cookieHeader,
                      signal,
                    ) as Promise<Envelope<TimeseriesPointDto[], unknown>>,
                ),
              ),
              queryClient.fetchInfiniteQuery(
                senderHistoryQueryOptions(
                  id,
                  async (cursor, signal) =>
                    serverGetEnvelope<
                      DecisionHistoryRowDto[],
                      PaginatedEnvelope<DecisionHistoryRowDto>['meta']
                    >(pagedPath('history', cursor), cookieHeader, signal) as Promise<
                      PaginatedEnvelope<DecisionHistoryRowDto>
                    >,
                ),
              ),
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
