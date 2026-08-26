import { headers } from 'next/headers';

import { hasServerAccessCookie } from '@/features/auth/api/server-me';
import {
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
  const query = sendersQueryFromSearchParams(params);

  return (
    <ServerSendersBoundary
      cookieHeader={cookieHeader}
      enabled={hasServerAccessCookie(cookieHeader)}
      query={query}
      summaryQ={query.q}
      includeSummary={query.q !== undefined && query.q.length > 0}
    >
      <SendersScreen />
    </ServerSendersBoundary>
  );
}
