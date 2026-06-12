// /screener — Screener queue (D71–D77).
//
// The Screener is a soft-quarantine surface for first-time senders.
// "Screener" is the product noun (D227-allowed); the verb "Screen" is
// banned as user-facing copy. Pro-only per D77 — the TierGate shows
// under-tier workspaces the upgrade placeholder; Pro workspaces see
// the build-status placeholder until the feature ships.

import { TierGate } from '@/features/billing/tier-gate';
import { RoutePlaceholder } from '@/features/route-placeholder/route-placeholder';

export const metadata = {
  title: 'Screener — DeclutrMail',
};

export default function ScreenerPage() {
  return (
    <TierGate
      capability="screener"
      title="Screener"
      pitch="A soft-quarantine queue for first-time senders. New senders wait at the door instead of landing in your inbox; decide once whether they belong, and the rule routes them automatically next time."
      bullets={[
        'New senders auto-route to the queue',
        'One decision covers every future email',
        'Nothing is touched in Gmail until you decide',
      ]}
    >
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
    </TierGate>
  );
}
