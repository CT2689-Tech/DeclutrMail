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

import { TierGate } from '@/features/billing/tier-gate';
import { BriefScreen } from '@/features/brief/brief-screen';

export const metadata = {
  title: 'Daily Brief — DeclutrMail',
};

export default function BriefPage() {
  return (
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
  );
}
