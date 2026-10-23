import { headers } from 'next/headers';

import { hasServerAccessCookie } from '@/features/auth/api/server-me';
import {
  sendersQueryFromSearchParams,
  type SendersSearchParams,
} from '@/features/senders/api/query-options';
import { ServerSendersBoundary } from '@/features/senders/server-senders-boundary';
import { CleanupWorkspace } from '@/features/cleanup/cleanup-workspace';
import { cleanupView } from '@/features/cleanup/cleanup-view';
import { ServerFirstReviewBoundary } from '@/features/cleanup/server-first-review-boundary';
import { ServerTriageBoundary } from '@/features/triage/server-triage-boundary';

export default async function SendersPage({
  searchParams,
}: {
  searchParams: Promise<SendersSearchParams>;
}) {
  const [requestHeaders, params] = await Promise.all([headers(), searchParams]);
  const cookieHeader = requestHeaders.get('cookie') ?? '';
  const query = sendersQueryFromSearchParams(params);
  const view = cleanupView(typeof params.view === 'string' ? params.view : null);
  const authenticated = hasServerAccessCookie(cookieHeader);

  return (
    <ServerSendersBoundary
      cookieHeader={cookieHeader}
      enabled={authenticated && view === 'all'}
      query={query}
      includeSettings={view !== 'guided'}
    >
      <ServerTriageBoundary
        cookieHeader={cookieHeader}
        enabled={authenticated && view === 'guided'}
      >
        <ServerFirstReviewBoundary
          cookieHeader={cookieHeader}
          enabled={authenticated && view === 'first-review'}
        >
          <CleanupWorkspace />
        </ServerFirstReviewBoundary>
      </ServerTriageBoundary>
    </ServerSendersBoundary>
  );
}
