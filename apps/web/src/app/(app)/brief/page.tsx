// /brief — Daily Brief surface (D61, D63, D65, D67, D69, D70).
//
// Backend snapshot worker (#102) generates the 3-section frozen
// snapshot per D69. This page renders that payload via the FE feature
// module at `apps/web/src/features/brief/brief-screen.tsx`.
//
// D68 Pro gate: Free/Plus workspaces see the placeholder + upgrade CTA
// instead of the Brief (the TierGate also stops the under-tier brief
// fetch from ever firing).
//
// The Noise line DIVERGES from D68's card, deliberately. D68 reads
// "NOISE — one-click archive"; D65 has now shipped and the real flow is
// review the checked senders → Archive → mandatory preview → confirm.
// D226 makes that preview non-skippable, so "one-click" is not something
// this feature can grow into — it is a claim the architecture forbids.
// The bullet below sells the same capability in words the product keeps.
// Recorded as plan drift in FOUNDER-FOLLOWUPS.md (2026-08-10); the plan
// edit is the founder's. PR #495 had reworded this line differently while
// D65 was still unbuilt.

import { headers } from 'next/headers';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { BRIEF_NAME } from '@declutrmail/shared/copy/screen-decisions';
import { hasCapability } from '@declutrmail/shared/entitlements';

import { BriefScreen } from '@/features/brief/brief-screen';
import { ProLockedGate } from '@/features/launch/pro-locked-gate';
import { briefTodayQueryOptions } from '@/features/brief/api/query-options';
import { getServerMe } from '@/features/auth/api/server-me';
import type { BriefWire } from '@/lib/api/brief';
import { ServerApiError, serverGetEnvelope } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';

export const metadata = {
  title: 'Daily brief — DeclutrMail',
};

export default async function BriefPage() {
  const cookieHeader = (await headers()).get('cookie') ?? '';
  const me = await getServerMe(cookieHeader);
  const enabled = me?.activeMailboxId != null && me !== null && hasCapability(me.tier, 'brief');

  return (
    <ServerQueryHydration
      surface="brief"
      prefetch={(queryClient) =>
        enabled
          ? [
              queryClient.fetchQuery(
                briefTodayQueryOptions(async (signal) => {
                  try {
                    return await serverGetEnvelope<BriefWire>(
                      '/api/briefs/today',
                      cookieHeader,
                      signal,
                    );
                  } catch (error) {
                    // No edition yet is 204 (`{ data: null }`). A leftover 404
                    // is the same absence, so hydration does not repeat the read.
                    if (error instanceof ServerApiError && error.status === 404) {
                      return { data: null };
                    }
                    throw error;
                  }
                }),
              ),
            ]
          : []
      }
    >
      <ProLockedGate
        capability="brief"
        source="brief"
        title={WS2_COPY.pro.brief.title.replaceAll('{BRIEF_NAME}', BRIEF_NAME)}
        pitch={WS2_COPY.pro.brief.pitch.replaceAll('{BRIEF_NAME}', BRIEF_NAME)}
      >
        <BriefScreen />
      </ProLockedGate>
    </ServerQueryHydration>
  );
}
