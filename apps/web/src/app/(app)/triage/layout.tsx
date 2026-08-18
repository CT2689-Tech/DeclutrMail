import type { ReactNode } from 'react';
import { headers } from 'next/headers';

import { getServerMe } from '@/features/auth/api/server-me';
import { shouldPrefetchTriage } from '@/features/triage/api/query-options';
import { ServerTriageBoundary } from '@/features/triage/server-triage-boundary';

export default async function TriageLayout({ children }: { children: ReactNode }) {
  const requestHeaders = await headers();
  const cookieHeader = requestHeaders.get('cookie') ?? '';
  const me = await getServerMe(cookieHeader);
  const enabled = shouldPrefetchTriage(me);

  return (
    <ServerTriageBoundary cookieHeader={cookieHeader} enabled={enabled}>
      {children}
    </ServerTriageBoundary>
  );
}
