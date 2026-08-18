import { headers } from 'next/headers';
import { hasCapability } from '@declutrmail/shared/entitlements';

import { TierGate } from '@/features/billing/tier-gate';
import { FollowupsScreen } from '@/features/followups/followups-screen';
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
      <TierGate
        capability="followups"
        title="Follow-ups"
        pitch="Threads where you sent the last message and haven't heard back, sorted oldest first."
        bullets={[
          'Grouped by how overdue they are',
          'Open the thread in Gmail in one click',
          'Mark resolved when you nudged them another way',
        ]}
      >
        <FollowupsScreen />
      </TierGate>
    </ServerQueryHydration>
  );
}
