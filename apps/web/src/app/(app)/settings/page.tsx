// /settings — Settings index (U23 — D34, D114, D116, D216).
//
// Sectioned single-page settings: Mailboxes, Action preferences (D34
// skip-sheet toggles), Email notifications, Sender lists link, Privacy
// & Data link, Plan & Billing summary, and the Account danger zone
// (#218's AccountDeletionSection). The `?cancelDeletion=1` deep link
// (from the deletion-scheduled email) scrolls to + highlights the
// Account section.

import { Suspense } from 'react';

import { SettingsScreen } from '@/features/settings/settings-index/settings-screen';

export const metadata = {
  title: 'Settings — DeclutrMail',
};

/**
 * Suspense boundary required because `SettingsScreen` reads the
 * `?cancelDeletion=1` deep link via `useSearchParams()`, which Next.js
 * requires to be wrapped at the route boundary in app-router.
 */
export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsScreen />
    </Suspense>
  );
}
