// Per-route error boundary for `/screener` (D167 + D170 + D211).
// 2026-07-04 launch audit: this route previously fell through to the
// global boundary. Copy + capture live in the shared screen.

'use client';

import { RouteErrorScreen } from '@/components/route-error-screen';

export default function ScreenerError({
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
      boundary="screener"
      eyebrow="The Screener hit a snag"
      headline="We couldn't load the Screener."
      body="New-sender decisions are safe and nothing was let through. Try again, or continue in Triage."
      escape={{ href: '/triage', label: 'Back to Triage' }}
    />
  );
}
