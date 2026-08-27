import type { ReactNode } from 'react';
import { headers } from 'next/headers';

import { hasServerAccessCookie } from '@/features/auth/api/server-me';
import { ServerTriageBoundary } from '@/features/triage/server-triage-boundary';

export default async function TriageLayout({ children }: { children: ReactNode }) {
  const requestHeaders = await headers();
  const cookieHeader = requestHeaders.get('cookie') ?? '';

  return (
    <ServerTriageBoundary cookieHeader={cookieHeader} enabled={hasServerAccessCookie(cookieHeader)}>
      {children}
    </ServerTriageBoundary>
  );
}
