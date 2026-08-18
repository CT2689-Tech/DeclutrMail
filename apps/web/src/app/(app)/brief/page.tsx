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
import { hasCapability } from '@declutrmail/shared/entitlements';

import { TierGate } from '@/features/billing/tier-gate';
import { BriefScreen } from '@/features/brief/brief-screen';
import { briefTodayQueryOptions } from '@/features/brief/api/query-options';
import { getServerMe } from '@/features/auth/api/server-me';
import type { BriefWire } from '@/lib/api/brief';
import { serverGetEnvelope } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';

export const metadata = {
  title: 'Daily Brief — DeclutrMail',
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
                briefTodayQueryOptions((signal) =>
                  serverGetEnvelope<BriefWire>('/api/briefs/today', cookieHeader, signal),
                ),
              ),
            ]
          : []
      }
    >
      <TierGate
        capability="brief"
        title="Your Morning Brief"
        pitch="A daily summary of yesterday's email, written in plain English — 8am daily, in-app or by email."
        bullets={[
          'REPLY — what actually needs you',
          'FYI — facts to know',
          'NOISE — archive the whole pile in one confirmed action',
        ]}
      >
        <BriefScreen />
      </TierGate>
    </ServerQueryHydration>
  );
}
