// Per-route error boundary for `/settings` (D167 + D170 + D211).
// 2026-07-04 launch audit: this route previously fell through to the
// global boundary. Copy + capture live in the shared screen.

'use client';

import { RouteErrorScreen } from '@/components/route-error-screen';

export default function SettingsError({
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
      boundary="settings"
      headline="We couldn't load your settings."
      body="Try again. If you came from an email link, reopening it also works."
      escape={{ href: '/senders', label: 'Back to Senders' }}
    />
  );
}
