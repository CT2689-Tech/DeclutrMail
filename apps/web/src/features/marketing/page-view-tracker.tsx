'use client';

// D159 funnel — one `page_viewed` per route mount for public marketing
// pages that are otherwise pure server components (legal pages, /beta).
// Same pattern as the landing masthead (marketing-nav.tsx) and
// BetaDeniedTracker: a tiny client island so the server-rendered prose
// ships no other JS. Calls go through `@/lib/posthog` — the single seam
// where D147's consent banner will gate the SDK when it lands.

import { useEffect } from 'react';
import type { EventProps } from '@declutrmail/shared/observability';

import { track } from '@/lib/posthog';

export function PageViewTracker({ page }: { page: EventProps<'page_viewed'>['page'] }) {
  useEffect(() => {
    void track('page_viewed', { page, mailbox_id: null });
  }, [page]);
  return null;
}
