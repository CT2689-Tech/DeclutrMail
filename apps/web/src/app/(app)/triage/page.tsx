import { headers } from 'next/headers';

import { hasServerAccessCookie } from '@/features/auth/api/server-me';
import { ServerTriageBoundary } from '@/features/triage/server-triage-boundary';

import { TriageRoute } from './triage-route';

/**
 * The prefetch boundary lives in the PAGE, not a `layout.tsx`: a layout
 * sits above the segment's `loading.tsx`, so a layout that awaits the
 * prefetch holds a sidebar click on the previous screen for the whole
 * read, and the loading boundary never gets a chance to show.
 */
export default async function TriagePage() {
  const cookieHeader = (await headers()).get('cookie') ?? '';

  return (
    <ServerTriageBoundary cookieHeader={cookieHeader} enabled={hasServerAccessCookie(cookieHeader)}>
      <TriageRoute />
    </ServerTriageBoundary>
  );
}
