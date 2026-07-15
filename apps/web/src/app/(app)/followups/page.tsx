import { TierGate } from '@/features/billing/tier-gate';
import { FollowupsScreen } from '@/features/followups/followups-screen';

/**
 * /followups route — the Followups screen (D90, D91).
 *
 * Thin route shell — the actual layout, data fetching, and state
 * branches live in `FollowupsScreen` so they can be exercised by tests
 * and Storybook without dragging in the Next router.
 *
 * Pro-gated per the D19 manifest (D77 automation set): under-tier
 * workspaces see the D68-style placeholder + upgrade CTA, and the
 * followups fetch never fires.
 */
export default function FollowupsPage() {
  return (
    <TierGate
      capability="followups"
      title="Follow-ups"
      pitch="Threads where you sent the last message and haven't heard back, sorted oldest first."
      bullets={[
        'Grouped by how overdue they are',
        'Open the thread in Gmail in one click',
        'Mark resolved when you nudged them another way',
      ]}
    >
      <FollowupsScreen />
    </TierGate>
  );
}
