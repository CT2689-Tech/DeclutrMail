import { headers } from 'next/headers';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { hasCapability } from '@declutrmail/shared/entitlements';

import { FollowupsScreen } from '@/features/followups/followups-screen';
import { ProLockedGate } from '@/features/launch/pro-locked-gate';
import { followupsQueryOptions } from '@/features/followups/api/query-options';
import { getServerMe } from '@/features/auth/api/server-me';
import type { FollowupRow } from '@/lib/api/followups';
import { serverGetEnvelope } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';

/**
 * /followups route — the Followups screen (D90, D91).
 *
 * Thin route shell — the actual layout, data fetching, and state
 * branches live in `FollowupsScreen` so they can be exercised by tests
 * and Storybook without dragging in the Next router.
 *
 * Pro-gated per the D19 manifest (D77 automation set): under-tier
 * workspaces see the D68-style placeholder + upgrade CTA, and the
 * followups fetch never fires.
 */
export default async function FollowupsPage() {
  const cookieHeader = (await headers()).get('cookie') ?? '';
  const me = await getServerMe(cookieHeader);
  const enabled = me?.activeMailboxId != null && me !== null && hasCapability(me.tier, 'followups');

  return (
    <ServerQueryHydration
      surface="followups"
      prefetch={(queryClient) =>
        enabled
          ? [
              queryClient.fetchQuery(
                followupsQueryOptions((signal) =>
                  serverGetEnvelope<FollowupRow[]>('/api/followups', cookieHeader, signal),
                ),
              ),
            ]
          : []
      }
    >
      <ProLockedGate
        capability="followups"
        source="followups"
        title={WS2_COPY.pro.followups.title}
        pitch={WS2_COPY.pro.followups.pitch}
      >
        <FollowupsScreen />
      </ProLockedGate>
    </ServerQueryHydration>
  );
}
