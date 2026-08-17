import 'server-only';

import type { ReactNode } from 'react';
import type { MeSettings } from '@declutrmail/shared/contracts';

import {
  sendersListPath,
  type SenderListEnvelope,
  type SenderListRow,
  type SenderSummaryDto,
} from '@/lib/api/senders';
import { serverGetEnvelope } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';
import { meSettingsQueryOptions } from '@/features/settings/api/query-options';
import {
  DEFAULT_SENDERS_QUERY,
  sendersInfiniteQueryOptions,
  sendersSummaryQueryOptions,
  type SendersQueryOptions,
} from './api/query-options';

export async function ServerSendersBoundary({
  cookieHeader,
  enabled,
  query = DEFAULT_SENDERS_QUERY,
  summaryQ,
  includeSummary = true,
  includeSettings = true,
  children,
}: {
  cookieHeader: string;
  enabled: boolean;
  query?: SendersQueryOptions;
  summaryQ?: string | undefined;
  includeSummary?: boolean;
  includeSettings?: boolean;
  children: ReactNode;
}) {
  return ServerQueryHydration({
    surface: 'senders',
    prefetch: (queryClient) =>
      enabled
        ? [
            queryClient.fetchInfiniteQuery(
              sendersInfiniteQueryOptions(query, async (_params, signal) => {
                const envelope = await serverGetEnvelope<
                  SenderListRow[],
                  SenderListEnvelope['meta']
                >(sendersListPath(_params), cookieHeader, signal);
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
            ...(includeSummary
              ? [
                  queryClient.fetchQuery(
                    sendersSummaryQueryOptions({ q: summaryQ }, (params, signal) =>
                      serverGetEnvelope<SenderSummaryDto>(
                        params.q
                          ? `/api/senders/summary?q=${encodeURIComponent(params.q)}`
                          : '/api/senders/summary',
                        cookieHeader,
                        signal,
                      ),
                    ),
                  ),
                ]
              : []),
            ...(includeSettings
              ? [
                  queryClient.fetchQuery(
                    meSettingsQueryOptions((signal) =>
                      serverGetEnvelope<MeSettings>('/api/me/settings', cookieHeader, signal).then(
                        (envelope) => envelope.data,
                      ),
                    ),
                  ),
                ]
              : []),
          ]
        : [],
    children,
  });
}
