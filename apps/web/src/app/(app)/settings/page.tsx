// /settings — Settings index (U23 — D34, D114, D116, D216).
//
// One column of grouped rows: Gmail accounts, Actions (D34 preview
// placement), Notifications, drill-ins (protected senders, privacy &
// data, help, plan & billing), and the Account group (#218's
// AccountDeletionSection). The `?cancelDeletion=1` deep link
// (from the deletion-scheduled email) scrolls to + highlights the
// Account section.

import { Suspense } from 'react';
import { headers } from 'next/headers';
import type { MeSettings } from '@declutrmail/shared/contracts';

import { SettingsScreen } from '@/features/settings/settings-index/settings-screen';
import { meSettingsQueryOptions } from '@/features/settings/api/query-options';
import { hasServerAccessCookie } from '@/features/auth/api/server-me';
import { serverGet } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';

export const metadata = {
  title: 'Settings — DeclutrMail',
};

/**
 * Suspense boundary required because `SettingsScreen` reads the
 * `?cancelDeletion=1` deep link via `useSearchParams()`, which Next.js
 * requires to be wrapped at the route boundary in app-router.
 */
export default async function SettingsPage() {
  const cookieHeader = (await headers()).get('cookie') ?? '';
  // The user-scoped preferences endpoint authenticates this read itself.
  // Start it independently of the app shell's session bootstrap.
  const eligible = hasServerAccessCookie(cookieHeader);

  return (
    <ServerQueryHydration
      surface="settings"
      prefetch={(queryClient) => {
        if (!eligible) return [];
        return [
          queryClient.fetchQuery(
            meSettingsQueryOptions((signal) =>
              serverGet<MeSettings>('/api/me/settings', cookieHeader, signal),
            ),
          ),
        ];
      }}
    >
      <Suspense fallback={null}>
        <SettingsScreen />
      </Suspense>
    </ServerQueryHydration>
  );
}
