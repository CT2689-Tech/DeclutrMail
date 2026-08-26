// /quiet — Quiet hours configuration (U18 — D92, D95).
//
// Per-mailbox recurring quiet window: while it covers "now", Autopilot
// mutations defer (AutopilotActionWorker Guard 1) and run after the
// window ends. Manual user actions are never deferred.
//
// Gated on the `quiet` capability, resolved from the manifest — Quiet
// governs Autopilot, so it is granted wherever Autopilot is. Without
// the TierGate this page rendered a fully editable form to an
// unentitled user whose Save PUT would 402 — a silent trap (2026-07-10
// dogfood). The gate shows the upgrade placeholder instead.

import { headers } from 'next/headers';
import { hasCapability } from '@declutrmail/shared/entitlements';
import type { QuietHoursState } from '@declutrmail/shared/contracts';

import { TierGate } from '@/features/billing/tier-gate';
import { QuietRoute } from '@/features/quiet/quiet-screen';
import { quietHoursQueryOptions } from '@/features/quiet/api/query-options';
import { getServerMe } from '@/features/auth/api/server-me';
import { serverGet } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';

export const metadata = {
  title: 'Quiet hours — DeclutrMail',
};

export default async function QuietPage() {
  const cookieHeader = (await headers()).get('cookie') ?? '';
  const me = await getServerMe(cookieHeader);
  const enabled = me !== null && me.activeMailboxId !== null && hasCapability(me.tier, 'quiet');

  return (
    <ServerQueryHydration
      surface="quiet"
      prefetch={(queryClient) =>
        enabled
          ? me.mailboxes.map((mailbox) =>
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
        title="Quiet hours"
        pitch="A daily window per mailbox where Autopilot holds its moves and runs them after the window ends. Your own actions always run immediately."
        bullets={[
          'Pick a start, end, and timezone per mailbox',
          'Deferred actions run after the window — nothing is skipped',
          'Manual actions are never held',
        ]}
      >
        <QuietRoute />
      </TierGate>
    </ServerQueryHydration>
  );
}
