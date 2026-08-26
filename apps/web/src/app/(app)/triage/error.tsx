// Per-route error boundary for `/triage` (D167 + D170 + D211).
// 2026-07-04 launch audit: this route previously fell through to the
// global boundary. Copy + capture live in the shared screen.

'use client';

import { RouteErrorScreen } from '@/components/route-error-screen';

export default function TriageError({
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
      boundary="triage"
      eyebrow="Triage hit a snag"
      headline="We couldn't load your triage queue."
      body="Your mailbox and decisions are untouched. Try again, or review senders while we sort this out."
      escape={{ href: '/senders', label: 'Back to Senders' }}
    />
  );
}
