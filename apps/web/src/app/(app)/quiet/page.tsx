// /quiet — Quiet hours configuration.
//
// Quiet hours pause Autopilot mutations + outbound notifications
// during user-chosen windows. Sidebar nav lists this surface but the
// feature is still queued — the stub lands now so the nav doesn't lie.

import { RoutePlaceholder } from '@/features/route-placeholder/route-placeholder';

export const metadata = {
  title: 'Quiet hours — DeclutrMail',
};

export default function QuietPage() {
  return (
    <RoutePlaceholder
      status="Planned for V2.2"
      title="Quiet hours"
      description={
        <>
          Pause Autopilot moves and outbound notifications during the hours you choose. Triage stays
          available — only the automated mutations sleep.
        </>
      }
      decisions={[]}
      primaryCta={{ href: '/autopilot', label: 'Open Autopilot' }}
      secondaryCta={{ href: '/settings', label: 'Account settings' }}
    />
  );
}
