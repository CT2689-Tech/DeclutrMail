// Per-route error boundary for `/quiet` (D167 + D170 + D211).
// 2026-07-04 launch audit: this route previously fell through to the
// global boundary. Copy + capture live in the shared screen.

'use client';

import { RouteErrorScreen } from '@/components/route-error-screen';

export default function QuietError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined };
  reset: () => void;
}) {
  return (
    <RouteErrorScreen
      title="Quiet hours"
      kicker="Automations / On your schedule"
      maxWidth={1120}
      error={error}
      reset={reset}
      boundary="quiet"
      headline="We couldn't load quiet hours."
      body="Your quiet hours are unchanged. Try again, or head back to Senders."
      escape={{ href: '/senders', label: 'Back to Senders' }}
    />
  );
}
