// Per-route error boundary for `/connect/authorize` (D167 + D170 + D211).

'use client';

import { RouteErrorScreen } from '@/components/route-error-screen';

export default function ConnectAuthorizeError({
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
      boundary="connect"
      headline="We couldn’t load this connection request."
      body="Try again, or go back to your app and connect again."
      escape={{ href: '/settings', label: 'Open Settings' }}
    />
  );
}
