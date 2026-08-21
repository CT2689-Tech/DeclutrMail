/**
 * Route-level Suspense fallback for Senders (audit 2026-08-21).
 *
 * `page.tsx` awaits `getServerMe` and THEN the senders prefetch (up to
 * the 2s hydration deadline), so the RSC response for this route is
 * gated on two sequential API round trips. With no `loading.tsx` the
 * App Router has no boundary to show in the meantime: tapping Senders
 * from inside the app left the PREVIOUS screen on display, unchanged,
 * for that whole window — on mobile, long enough to read as a dead tap
 * (founder, 2026-08-21).
 *
 * This does not make the data arrive sooner. It makes the wait legible,
 * and it is the same skeleton the screen shows for its own pending
 * read, so the SSR-miss path does not flash a second, different
 * loading state.
 */

import { SendersLoadingState } from '@/features/senders/senders-loading-state';

export default function Loading() {
  return <SendersLoadingState />;
}
