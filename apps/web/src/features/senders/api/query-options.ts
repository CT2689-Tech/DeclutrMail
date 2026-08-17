import type { Envelope } from '@declutrmail/shared/contracts';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import {
  sendersListPath,
  type ListSendersParams,
  type SenderListEnvelope,
  type SenderSummaryDto,
} from '@/lib/api/senders';
import { sendersKeys } from './query-keys';
import {
  parseSendersScope,
  searchParamsFromRecord,
  type SendersScreenScope,
} from './senders-scope';

export type { SendersScreenScope } from './senders-scope';

export type SendersQueryOptions = Omit<ListSendersParams, 'cursor'>;
export type SendersSearchParams = Record<string, string | string[] | undefined>;

export function sendersListQueryFromScreen(
  scope: SendersScreenScope,
  limit = 50,
): SendersQueryOptions {
  return {
    limit,
    sort: scope.sort,
    direction: scope.direction,
    q: scope.q,
    activity: scope.compose.activity ?? undefined,
    activityNegate: scope.compose.activity ? scope.compose.activityNegate : undefined,
    unsubReady: scope.compose.unsubReady,
    replied: scope.compose.replied,
    windowDays: scope.compose.windowDays ?? undefined,
    domain: scope.compose.domain ?? undefined,
    isProtected: scope.compose.protectedFlag,
    unsubIgnored: scope.compose.unsubIgnored || undefined,
  };
}

export const DEFAULT_SENDERS_QUERY: SendersQueryOptions = sendersListQueryFromScreen({
  sort: 'total',
  direction: 'desc',
  q: '',
  compose: {
    activity: 'active',
    activityNegate: false,
    unsubReady: null,
    replied: null,
    protectedFlag: null,
    windowDays: null,
    domain: null,
    unsubIgnored: false,
  },
});

/**
 * Hydrate only when the URL is the same list the bare `/senders` screen
 * reads. Unknown keys (`utm_*`) and explicit `?activity=active` still
 * match. Real filters (`q`, `activity=all`, …) skip so we never flash
 * the default list.
 */
export function shouldHydrateDefaultSenders(
  params: SendersSearchParams | Pick<URLSearchParams, 'get'>,
): boolean {
  const candidate = params as Partial<Pick<URLSearchParams, 'get'>>;
  const search =
    typeof candidate.get === 'function'
      ? (candidate as Pick<URLSearchParams, 'get'>)
      : searchParamsFromRecord(params as SendersSearchParams);
  const query = sendersListQueryFromScreen(parseSendersScope(search));
  return sendersListPath(query) === sendersListPath(DEFAULT_SENDERS_QUERY);
}

export function shouldPrefetchSenders(
  me: { activeMailboxId: string | null } | null,
  params: SendersSearchParams,
): boolean {
  return me !== null && me.activeMailboxId !== null && shouldHydrateDefaultSenders(params);
}

type SendersReader = (
  params: ListSendersParams,
  signal: AbortSignal,
) => Promise<SenderListEnvelope>;

export function sendersInfiniteQueryOptions(options: SendersQueryOptions, reader: SendersReader) {
  return infiniteQueryOptions({
    queryKey: sendersKeys.list(options),
    queryFn: ({ pageParam, signal }) => reader({ ...options, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: SenderListEnvelope) => last.meta.pagination.nextCursor ?? undefined,
  });
}

type SendersSummaryReader = (
  params: { q?: string | undefined },
  signal: AbortSignal,
) => Promise<Envelope<SenderSummaryDto, unknown>>;

export function sendersSummaryQueryOptions(
  params: { q?: string | undefined },
  reader: SendersSummaryReader,
) {
  const q = params.q && params.q.length > 0 ? params.q : undefined;
  return queryOptions({
    queryKey: sendersKeys.summary({ q }),
    queryFn: ({ signal }) => reader({ q }, signal),
  });
}
