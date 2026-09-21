// Per-route error boundary for `/autopilot` (D38 + D167 + D211). Scopes a
// render throw to this route; the `autopilot` tag groups it in Sentry.
// Copy + capture live in the shared screen (privacy D7: `error.message`
// is never rendered there).

'use client';

import { RouteErrorScreen } from '@/components/route-error-screen';

export default function AutopilotError({
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
      boundary="autopilot"
      headline="We couldn't load your rules."
      body="Your rules and suggestions are unchanged. Try again, or continue in Triage."
      escape={{ href: '/triage', label: 'Back to Triage' }}
    />
  );
}
