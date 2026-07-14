'use client';

// D159 funnel — one `page_viewed` per route mount for public marketing
// pages that are otherwise pure server components (legal pages, /beta).
// Same pattern as the public shell nav (public-shell/) and
// BetaDeniedTracker: a tiny client island so the server-rendered prose
// ships no other JS. Calls go through `@/lib/posthog` — the single seam
// where D147's consent banner will gate the SDK when it lands.

import type { EventProps } from '@declutrmail/shared/observability';

import { useConsentedPageView } from './use-consented-page-view';

export function PageViewTracker({ page }: { page: EventProps<'page_viewed'>['page'] }) {
  useConsentedPageView(page);
  return null;
}
