// Per-route error boundary for `/followups` (D167 + D170 + D211).
// 2026-07-04 launch audit: this route previously fell through to the
// global boundary. Copy + capture live in the shared screen.

'use client';

import { RouteErrorScreen } from '@/components/route-error-screen';

export default function FollowupsError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined };
  reset: () => void;
}) {
  return (
    <RouteErrorScreen
      error={error}
      reset={reset}
      boundary="followups"
      headline="We couldn't load your follow-ups."
      body="Your follow-ups are unchanged. Try again, or continue in Triage."
      escape={{ href: '/triage', label: 'Back to Triage' }}
    />
  );
}
