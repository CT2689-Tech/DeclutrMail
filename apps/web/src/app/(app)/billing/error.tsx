// Per-route error boundary for `/billing` (D167 + D170 + D211).
// 2026-07-04 launch audit: this route previously fell through to the
// global boundary. Copy + capture live in the shared screen.

'use client';

import { RouteErrorScreen } from '@/components/route-error-screen';

export default function BillingError({
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
      boundary="billing"
      headline="We couldn't load your billing details."
      body="Your plan is unchanged. Try again in a moment."
      escape={{ href: '/settings', label: 'Back to Settings' }}
    />
  );
}
