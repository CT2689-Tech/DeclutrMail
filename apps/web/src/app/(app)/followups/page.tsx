import { FollowupsScreen } from '@/features/followups/followups-screen';

/**
 * /followups route — the Followups screen (D90, D91).
 *
 * Thin route shell — the actual layout, data fetching, and state
 * branches live in `FollowupsScreen` so they can be exercised by tests
 * and Storybook without dragging in the Next router.
 */
export default function FollowupsPage() {
  return <FollowupsScreen />;
}
