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
      title="Help & glossary"
      kicker="Your workspace / A useful reference"
      gap={24}
      error={error}
      reset={reset}
      boundary="settings"
      headline="We couldn't load this settings page."
      body="Your settings are unchanged. Try again, or return to Settings."
      escape={{ href: '/settings', label: 'Back to Settings' }}
    />
  );
}
