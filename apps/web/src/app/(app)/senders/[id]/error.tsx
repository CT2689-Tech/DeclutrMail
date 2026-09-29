// Per-feature error boundary for `/senders/[id]` (D38 session-3; D167 +
// D170 + D211). Without it the segment falls through to `app/error.tsx`,
// which takes over the whole authed shell; scoped here, the chrome stays
// usable and "Back to Senders" lands somewhere recognisable. Copy +
// capture (and the D7 digest-only rule) live in the shared screen.

'use client';

import { RouteErrorScreen } from '@/components/route-error-screen';

export default function SenderDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined };
  reset: () => void;
}) {
  return (
    <RouteErrorScreen
      title="Sender details"
      kicker="Clean up / Your sender"
      maxWidth={1120}
      error={error}
      reset={reset}
      boundary="senders-detail"
      headline="We couldn't load this sender."
      body="Your mailbox and decisions are untouched. Try again, or head back to Senders."
      escape={{ href: '/senders', label: 'Back to Senders' }}
    />
  );
}
