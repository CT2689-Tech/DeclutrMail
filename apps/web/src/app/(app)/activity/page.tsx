// /activity — Activity log (D55–D60).
//
// Undo affordance (D58) is shipped via the persistent action tray;
// the standalone activity-log view that lets you scrub by filter and
// time window lands in its own PR. Stub keeps the sidebar honest in
// the meantime.

import { RoutePlaceholder } from '@/features/route-placeholder/route-placeholder';

export const metadata = {
  title: 'Activity — DeclutrMail',
};

export default function ActivityPage() {
  return (
    <RoutePlaceholder
      status="Planned for V2.1"
      title="Activity"
      description={
        <>
          Every decision you&rsquo;ve made — Keep, Archive, Unsubscribe, Later — in one filterable
          timeline. Undo is available inline while the window is open.
        </>
      }
      decisions={['D55', 'D56', 'D57', 'D58', 'D59', 'D60']}
      primaryCta={{ href: '/triage', label: 'Open Triage' }}
      secondaryCta={{ href: '/senders', label: 'Browse senders' }}
    />
  );
}
