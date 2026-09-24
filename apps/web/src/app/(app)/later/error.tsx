// Per-route error boundary for canonical `/later` (D167, D170, D211, D245).

'use client';

import { RouteErrorScreen } from '@/components/route-error-screen';

export default function LaterError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined };
  reset: () => void;
}) {
  return (
    <RouteErrorScreen
      gap={32}
      title="Later"
      kicker="Catch up / Coming back to you"
      maxWidth={1120}
      error={error}
      reset={reset}
      boundary="snoozed"
      headline="We couldn't load your Later items."
      body="Nothing was moved or rescheduled. Try again, or continue in Triage."
      escape={{ href: '/triage', label: 'Back to Triage' }}
    />
  );
}
