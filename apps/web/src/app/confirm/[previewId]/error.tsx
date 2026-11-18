// Per-route error boundary for `/confirm/<previewId>` (D167 + D170 + D211).

'use client';

import { RouteErrorScreen } from '@/components/route-error-screen';

export default function ConfirmPreviewError({
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
      headline="We couldn’t load this request."
      body="Try again, or open Activity to see what has run."
      escape={{ href: '/activity', label: 'Open Activity' }}
    />
  );
}
