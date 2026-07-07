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
      eyebrow="Setup hit a snag"
      headline="We couldn't load this onboarding step."
      body="Nothing is lost — your progress is saved on our side. Try again, and if you just connected Gmail, the connection almost certainly succeeded."
      escape={{ href: '/', label: 'Back to home' }}
    />
  );
}
