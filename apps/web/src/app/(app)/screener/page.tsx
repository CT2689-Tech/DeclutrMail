// /screener — the Screener queue (D71–D77).
//
// Soft-quarantine review surface for first-time senders (D72 — Gmail
// untouched until the user decides). "Screener" is the product noun
// (D227-allowed); the verbs are the canonical K/A/U/L/D set. Granted
// from Plus per D251 (reversing D77's Pro-only): under-tier (Free)
// workspaces see the upgrade surface and never
// fire a Screener query (the BE 402s them regardless — defense in
// depth).

import { headers } from 'next/headers';
import { hasCapability } from '@declutrmail/shared/entitlements';

import { getServerMe } from '@/features/auth/api/server-me';
import { screenerQueueQueryOptions } from '@/features/screener/api/query-options';
import type { ScreenerQueueRow } from '@/features/screener/data';
import { ScreenerRoute } from '@/features/screener/screener-route';
import { serverGet } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';

export default async function ScreenerPage() {
  const cookieHeader = (await headers()).get('cookie') ?? '';
  const me = await getServerMe(cookieHeader);
  const mailboxId = me?.activeMailboxId ?? undefined;
  const enabled = mailboxId !== undefined && me !== null && hasCapability(me.tier, 'screener');

  return (
    <ServerQueryHydration
      surface="screener"
      prefetch={(queryClient) =>
        enabled
          ? [
              queryClient.fetchQuery(
                screenerQueueQueryOptions((signal) =>
                  serverGet<ScreenerQueueRow[]>('/api/screener/queue', cookieHeader, signal, {
                    mailboxId,
                  }),
                ),
              ),
            ]
          : []
      }
    >
      <ScreenerRoute />
    </ServerQueryHydration>
  );
}
