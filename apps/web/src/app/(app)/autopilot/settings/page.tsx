import { headers } from 'next/headers';
import { hasCapability } from '@declutrmail/shared/entitlements';
import type { QuietHoursState } from '@declutrmail/shared/contracts';

import { TierGate } from '@/features/billing/tier-gate';
import { AutopilotSettingsRoute } from '@/features/quiet/quiet-screen';
import { quietHoursQueryOptions } from '@/features/quiet/api/query-options';
import { getServerMe } from '@/features/auth/api/server-me';
import { serverGet } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';

export const metadata = {
  title: 'Autopilot settings — DeclutrMail',
};

export default async function AutopilotSettingsPage() {
  const cookieHeader = (await headers()).get('cookie') ?? '';
  const me = await getServerMe(cookieHeader);
  const enabled = me !== null && me.activeMailboxId !== null && hasCapability(me.tier, 'quiet');

  return (
    <ServerQueryHydration
      surface="quiet"
      prefetch={(queryClient) =>
        enabled
          ? me.mailboxes
              .filter((mailbox) => mailbox.id === me.activeMailboxId)
              .map((mailbox) =>
                queryClient.fetchQuery(
                  quietHoursQueryOptions(mailbox.id, (signal) =>
                    serverGet<QuietHoursState>(
                      `/api/mailboxes/${encodeURIComponent(mailbox.id)}/quiet-hours`,
                      cookieHeader,
                      signal,
                    ),
                  ),
                ),
              )
          : []
      }
    >
      <TierGate
        capability="quiet"
        title="Schedule"
        pitch="Choose a daily pause window for Autopilot in each inbox."
      >
        <AutopilotSettingsRoute />
      </TierGate>
    </ServerQueryHydration>
  );
}
