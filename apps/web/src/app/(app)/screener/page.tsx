// /screener — Screener queue (D71–D77).
//
// The Screener is a soft-quarantine surface for first-time senders.
// "Screener" is the product noun (D227-allowed); the verb "Screen" is
// banned as user-facing copy. Pro-only at launch per D77 — the page
// will gate on tier when it lands.

import { RoutePlaceholder } from '@/features/route-placeholder/route-placeholder';

export const metadata = {
  title: 'Screener — DeclutrMail',
};

export default function ScreenerPage() {
  return (
    <RoutePlaceholder
      status="Planned for V2.1"
      title="Screener"
      description={
        <>
          A soft-quarantine queue for new senders. Decide once whether they belong in your inbox;
          next time they show up, the rule routes them automatically.
        </>
      }
      decisions={['D71', 'D72', 'D73', 'D74', 'D75', 'D76', 'D77']}
      primaryCta={{ href: '/triage', label: 'Open Triage' }}
      secondaryCta={{ href: '/senders', label: 'Browse senders' }}
    />
  );
}
