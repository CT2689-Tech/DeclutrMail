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
      eyebrow="Follow-ups hit a snag"
      headline="We couldn't load your follow-ups."
      body="Your reminders are safe. Try again, or continue in Triage while we sort this out."
      escape={{ href: '/triage', label: 'Back to Triage' }}
    />
  );
}
