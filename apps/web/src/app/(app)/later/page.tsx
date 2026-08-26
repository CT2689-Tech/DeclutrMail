// /later — canonical sender-level Later review surface (D78–D80, D245).
//
// The internal capability, API, and worker names remain `snoozed` for
// compatibility. User-facing product language consistently says Later.

import { headers } from 'next/headers';
import { hasCapability } from '@declutrmail/shared/entitlements';

import { TierGate } from '@/features/billing/tier-gate';
import { SnoozedScreen } from '@/features/snoozed/snoozed-screen';
import { snoozedListQueryOptions } from '@/features/snoozed/api/query-options';
import { getServerMe } from '@/features/auth/api/server-me';
import type { SnoozedSenderRow } from '@/lib/api/snoozed';
import { serverGetEnvelope } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';

export const metadata = {
  title: 'Later — DeclutrMail',
};

export default async function LaterPage() {
  const cookieHeader = (await headers()).get('cookie') ?? '';
  const me = await getServerMe(cookieHeader);
  const enabled = me?.activeMailboxId != null && me !== null && hasCapability(me.tier, 'snoozed');

  return (
    <ServerQueryHydration
      surface="later"
      prefetch={(queryClient) =>
        enabled
          ? [
              queryClient.fetchQuery(
                snoozedListQueryOptions((signal) =>
                  serverGetEnvelope<SnoozedSenderRow[]>('/api/snoozed', cookieHeader, signal),
                ),
              ),
            ]
          : []
      }
    >
      <TierGate
        capability="snoozed"
        title="Later"
        pitch="Every sender you deferred with Later, in one list — grouped by when they return, with bring-back and scheduling controls."
        bullets={[
          'See everything parked with Later at a glance',
          'Bring a sender back now or change its return time',
          'Grouped by return time, so nothing slips',
        ]}
        footnote="Your Later senders are never hidden: their email sits in the DeclutrMail/Later label in Gmail, where you can read or move it any time."
      >
        <SnoozedScreen />
      </TierGate>
    </ServerQueryHydration>
  );
}
