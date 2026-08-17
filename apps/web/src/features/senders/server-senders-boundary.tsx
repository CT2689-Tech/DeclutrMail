import 'server-only';

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import {
  sendersListPath,
  type SenderListEnvelope,
  type SenderListRow,
  type SenderSummaryDto,
} from '@/lib/api/senders';
import { serverGetEnvelope } from '@/lib/api/server';
import { makeServerQueryClient, settleServerQueries } from '@/lib/server-query-client';
import {
  DEFAULT_SENDERS_QUERY,
  sendersInfiniteQueryOptions,
  sendersSummaryQueryOptions,
} from './api/query-options';

export async function ServerSendersBoundary({
  cookieHeader,
  enabled,
  children,
}: {
  cookieHeader: string;
  enabled: boolean;
  children: ReactNode;
}) {
  const queryClient = makeServerQueryClient();

  if (enabled) {
    await settleServerQueries('senders', [
      queryClient.fetchInfiniteQuery(
        sendersInfiniteQueryOptions(DEFAULT_SENDERS_QUERY, async (_params, signal) => {
          const envelope = await serverGetEnvelope<SenderListRow[], SenderListEnvelope['meta']>(
            sendersListPath(DEFAULT_SENDERS_QUERY),
            cookieHeader,
            signal,
          );
          if (
            envelope.meta == null ||
            typeof envelope.meta !== 'object' ||
            !('pagination' in envelope.meta) ||
            !('query' in envelope.meta)
          ) {
            throw new Error('GET /api/senders returned invalid pagination metadata.');
          }
          return envelope as SenderListEnvelope;
        }),
      ),
      queryClient.fetchQuery(
        sendersSummaryQueryOptions({}, (_params, signal) =>
          serverGetEnvelope<SenderSummaryDto>('/api/senders/summary', cookieHeader, signal),
        ),
      ),
    ]);
  }

  return <HydrationBoundary state={dehydrate(queryClient)}>{children}</HydrationBoundary>;
}
