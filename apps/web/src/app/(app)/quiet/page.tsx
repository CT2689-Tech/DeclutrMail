// /quiet — Quiet hours configuration (U18 — D92, D95).
//
// Per-mailbox recurring quiet window: while it covers "now", Autopilot
// mutations defer (AutopilotActionWorker Guard 1) and run after the
// window ends. Manual user actions are never deferred.

import { QuietRoute } from '@/features/quiet/quiet-screen';

export const metadata = {
  title: 'Quiet hours — DeclutrMail',
};

export default function QuietPage() {
  return <QuietRoute />;
}
