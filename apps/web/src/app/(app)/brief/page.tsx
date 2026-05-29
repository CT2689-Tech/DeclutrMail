// /brief — Daily Brief surface (D61, D63, D67, D69, D70).
//
// Backend snapshot worker (#102) generates the 3-section frozen
// snapshot per D69. This page renders that payload via the FE feature
// module at `apps/web/src/features/brief/brief-screen.tsx`. D65 noise
// bulk-archive + D68 Pro-tier gate land in their own follow-up PRs —
// see FOUNDER-FOLLOWUPS for the gate scope.

import { BriefScreen } from '@/features/brief/brief-screen';

export const metadata = {
  title: 'Daily Brief — DeclutrMail',
};

export default function BriefPage() {
  return <BriefScreen />;
}
