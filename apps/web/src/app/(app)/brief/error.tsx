// Per-route error boundary for `/brief` (D38 + D167 + D211). Scopes a
// render throw to this route; the `brief` tag groups it in Sentry.
// Copy + capture live in the shared screen (privacy D7: `error.message`
// is never rendered there).

'use client';

import { RouteErrorScreen } from '@/components/route-error-screen';

export default function BriefError({
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
      boundary="brief"
      headline="We couldn't open your Brief."
      body="Your mailbox is unchanged. Try again, or continue in Triage."
      escape={{ href: '/triage', label: 'Back to Triage' }}
    />
  );
}
