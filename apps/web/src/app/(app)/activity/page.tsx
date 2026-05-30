// /activity — Activity feed surface (D55-D60, tracer-bullet).
//
// Backend ActivityModule shipped in this PR; the screen reads from
// `GET /api/activity?window=&source=&cursor=`. D57 row expansion + D60
// mobile-specific layout + per-sender feed + D58 undo wire-up land in
// follow-up PRs — see PR body for the deferred scope.

import { Suspense } from 'react';

import { ActivityScreen } from '@/features/activity/activity-screen';

export const metadata = {
  title: 'Activity — DeclutrMail',
};

/**
 * Suspense boundary required because `ActivityScreen` reads URL state
 * via `useSearchParams()`, which Next.js requires to be wrapped at the
 * route boundary in app-router. The fallback is intentionally minimal
 * (the screen itself ships a richer loading skeleton).
 */
export default function ActivityPage() {
  return (
    <Suspense fallback={null}>
      <ActivityScreen />
    </Suspense>
  );
}
