// /brief — Daily Brief surface (D61, D63, D67, D69, D70).
//
// Backend snapshot worker (#102) generates the 3-section frozen
// snapshot per D69. This page renders that payload via the FE feature
// module at `apps/web/src/features/brief/brief-screen.tsx`.
//
// D68 Pro gate: Free/Plus workspaces see the placeholder + upgrade CTA
// instead of the Brief (the TierGate also stops the under-tier brief
// fetch from ever firing). Placeholder copy mirrors D68's card EXCEPT
// the Noise line: D68's card reads "NOISE — one-click archive", which
// is D65 (⬜ not started — the section is a read-only per-sender count
// list with a Gmail deep-link today). The gate describes what ships
// now; restore D68's wording when D65 lands.

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
        'NOISE — noisy senders, with message counts and a Gmail link',
      ]}
    >
      <BriefScreen />
    </TierGate>
  );
}
