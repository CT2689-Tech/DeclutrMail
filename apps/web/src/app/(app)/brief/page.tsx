// /brief — Daily Brief surface (D61–D70).
//
// Backend snapshot worker is shipped (#102). The frontend page lands
// in its own PR; until then this stub keeps the sidebar honest. When
// the Brief screen lands, swap this stub for the real `<BriefScreen />`
// route shell — the surface chrome (status chip, heading, CTA pattern)
// is owned by `RoutePlaceholder` and does not need to move.

import { RoutePlaceholder } from '@/features/route-placeholder/route-placeholder';

export const metadata = {
  title: 'Daily Brief — DeclutrMail',
};

export default function BriefPage() {
  return (
    <RoutePlaceholder
      status="Planned for V2.1"
      title="Daily Brief"
      description={
        <>
          A short morning summary of yesterday&rsquo;s mail — split into Reply, FYI, and Noise — so
          you can start the day from one calm screen instead of an inbox.
        </>
      }
      decisions={['D61', 'D62', 'D63', 'D67', 'D69', 'D70']}
      primaryCta={{ href: '/triage', label: 'Open Triage' }}
      secondaryCta={{ href: '/senders', label: 'Browse senders' }}
    />
  );
}
