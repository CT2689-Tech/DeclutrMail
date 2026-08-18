import { headers } from 'next/headers';

import { getServerMe } from '@/features/auth/api/server-me';
import {
  shouldPrefetchSenders,
  sendersQueryFromSearchParams,
  type SendersSearchParams,
} from '@/features/senders/api/query-options';
import { ServerSendersBoundary } from '@/features/senders/server-senders-boundary';
import { SendersScreen } from '@/features/senders/senders-screen';

export default async function SendersPage({
  searchParams,
}: {
  searchParams: Promise<SendersSearchParams>;
}) {
  const [requestHeaders, params] = await Promise.all([headers(), searchParams]);
  const cookieHeader = requestHeaders.get('cookie') ?? '';
  const me = await getServerMe(cookieHeader);
  const query = sendersQueryFromSearchParams(params);

  return (
    <ServerSendersBoundary
      cookieHeader={cookieHeader}
      enabled={shouldPrefetchSenders(me)}
      query={query}
      summaryQ={query.q}
      includeSummary={query.q !== undefined && query.q.length > 0}
    >
      <SendersScreen />
    </ServerSendersBoundary>
  );
}
