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
        pitch="Every sender you moved to Later, grouped by when they return."
        footnote="Their email stays readable in Gmail under the DeclutrMail/Later label."
      >
        <SnoozedScreen />
      </TierGate>
    </ServerQueryHydration>
  );
}
