// /quiet — Quiet hours configuration (U18 — D92, D95).
//
// Per-mailbox recurring quiet window: while it covers "now", Autopilot
// mutations defer (AutopilotActionWorker Guard 1) and run after the
// window ends. Manual user actions are never deferred.
//
// Pro-only per the D19 manifest (quiet hours modulate Autopilot, which
// is itself Pro). Without the TierGate this page rendered a fully
// editable form on free tier whose Save PUT would 402 — a silent trap
// (2026-07-10 dogfood). The gate shows the upgrade placeholder instead.

import { TierGate } from '@/features/billing/tier-gate';
import { QuietRoute } from '@/features/quiet/quiet-screen';

export const metadata = {
  title: 'Quiet hours — DeclutrMail',
};

export default function QuietPage() {
  return (
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
  );
}
