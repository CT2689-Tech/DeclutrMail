// Per-feature error boundary for `/senders` (D167 + D170 + D211). Scopes a
// render throw to this route so the app shell + nav stay usable; tag
// `senders` groups in Sentry distinctly. Copy + capture (and the D7
// digest-only rule) live in the shared screen.

'use client';

import { RouteErrorScreen } from '@/components/route-error-screen';

export default function SendersError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined };
  reset: () => void;
}) {
  return (
    <RouteErrorScreen
      title="Senders"
      kicker="Your inbox, by sender"
      maxWidth={1480}
      error={error}
      reset={reset}
      boundary="senders"
      headline="We couldn't load your senders."
      body="Your mailbox and decisions are untouched. Try again, or head to Triage and come back in a moment."
      escape={{ href: '/triage', label: 'Back to Triage' }}
    />
  );
}
