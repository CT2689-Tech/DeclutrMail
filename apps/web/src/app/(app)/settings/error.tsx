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
      gap={32}
      title="Settings"
      kicker="Your workspace / Preferences"
      error={error}
      reset={reset}
      boundary="settings"
      headline="We couldn't load your settings."
      body="Try again, or head back to Senders."
      escape={{ href: '/senders', label: 'Back to Senders' }}
    />
  );
}
