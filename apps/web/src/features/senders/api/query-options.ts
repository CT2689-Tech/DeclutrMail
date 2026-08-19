import type { Envelope, PaginatedEnvelope } from '@declutrmail/shared/contracts';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import {
  type DecisionHistoryRowDto,
  type ListSendersParams,
  type MailMessageRow,
  type SenderDetailDto,
  type SenderListEnvelope,
  type SenderSummaryDto,
  type TimeseriesPointDto,
} from '@/lib/api/senders';
import { sendersKeys } from './query-keys';
import { retryUnless4xx } from './retry';
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
    wroteTo: scope.compose.wroteTo,
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
    wroteTo: null,
    protectedFlag: null,
    windowDays: null,
    domain: null,
    unsubIgnored: false,
  },
});

/** Exact first-page query the client screen derives from a route URL. */
export function sendersQueryFromSearchParams(params: SendersSearchParams): SendersQueryOptions {
  return sendersListQueryFromScreen(parseSendersScope(searchParamsFromRecord(params)));
}

export function shouldPrefetchSenders(me: { activeMailboxId: string | null } | null): boolean {
  return me !== null && me.activeMailboxId !== null;
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

type SenderReader<T> = (signal: AbortSignal) => Promise<T>;

export function senderDetailQueryOptions(
  id: string,
  reader: SenderReader<Envelope<SenderDetailDto, unknown>>,
) {
  return queryOptions({
    queryKey: sendersKeys.detail(id),
    queryFn: ({ signal }) => reader(signal),
    retry: retryUnless4xx,
  });
}

export function senderMessagesQueryOptions(
  id: string,
  reader: (
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<PaginatedEnvelope<MailMessageRow>>,
) {
  return infiniteQueryOptions({
    queryKey: sendersKeys.messages(id),
    queryFn: ({ pageParam, signal }) => reader(pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.pagination.nextCursor ?? undefined,
    retry: retryUnless4xx,
  });
}

export function senderTimeseriesQueryOptions(
  id: string,
  reader: SenderReader<Envelope<TimeseriesPointDto[], unknown>>,
) {
  return queryOptions({
    queryKey: sendersKeys.timeseries(id),
    queryFn: ({ signal }) => reader(signal),
    retry: retryUnless4xx,
  });
}

export function senderHistoryQueryOptions(
  id: string,
  reader: (
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<PaginatedEnvelope<DecisionHistoryRowDto>>,
) {
  return infiniteQueryOptions({
    queryKey: sendersKeys.history(id),
    queryFn: ({ pageParam, signal }) => reader(pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.pagination.nextCursor ?? undefined,
    retry: retryUnless4xx,
  });
}
