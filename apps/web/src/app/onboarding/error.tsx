// Per-route error boundary for `/onboarding` (D167 + D170 + D211).
// 2026-07-04 launch audit: this route previously fell through to the
// global boundary. Copy + capture live in the shared screen.

'use client';

import { RouteErrorScreen } from '@/components/route-error-screen';

export default function OnboardingError({
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
      boundary="onboarding"
      headline="We couldn't load this onboarding step."
      body="Try again. Setup picks up from the last step the server recorded."
      escape={{ href: '/', label: 'Back to the website' }}
    />
  );
}
