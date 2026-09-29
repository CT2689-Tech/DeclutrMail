'use client';

import { RouteErrorScreen } from '@/components/route-error-screen';

export default function SettingsSectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined };
  reset: () => void;
}) {
  return (
    <RouteErrorScreen
      title="Privacy & data"
      kicker="Your workspace / Privacy & data"
      gap={32}
      error={error}
      reset={reset}
      boundary="settings"
      headline="We couldn't load this settings page."
      body="Your settings are unchanged. Try again, or return to Settings."
      escape={{ href: '/settings', label: 'Back to Settings' }}
    />
  );
}
