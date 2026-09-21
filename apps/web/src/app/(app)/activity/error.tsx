// Per-feature error boundary for `/activity` — D38 + FOUNDER-FOLLOWUPS
// 2026-06-06. Scopes a render throw to this route so the app shell + nav
// stay usable; tag `activity` groups in Sentry distinctly. Copy + capture
// (and the D7 digest-only rule) live in the shared screen.

'use client';

import { RouteErrorScreen } from '@/components/route-error-screen';

export default function ActivityError({
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
      boundary="activity"
      headline="We couldn't load your activity."
      body="Your decisions and undos are untouched. Try again, or head back to Triage."
      escape={{ href: '/triage', label: 'Back to Triage' }}
    />
  );
}
