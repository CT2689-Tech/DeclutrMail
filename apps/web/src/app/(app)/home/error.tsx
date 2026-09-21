// Per-route error boundary for `/home` (D167, D170, D211).

'use client';

import { RouteErrorScreen } from '@/components/route-error-screen';

export default function HomeError({
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
      boundary="home"
      headline="We couldn't load Home."
      body="Nothing in Gmail changed. Try again, or go to Senders."
      escape={{ href: '/senders', label: 'Back to Senders' }}
    />
  );
}
