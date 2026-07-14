'use client';

import { useEffect } from 'react';
import type { EventProps } from '@declutrmail/shared/observability';

import { CONSENT_CHANGE_EVENT, hasAnalyticsConsent } from '@/lib/cookie-consent';
import { track } from '@/lib/posthog';

type Page = EventProps<'page_viewed'>['page'];

/**
 * Emit one page view for this mount/path after consent exists. A first-time
 * visitor who accepts on the current page becomes observable immediately;
 * Essential-only visitors remain untracked. The local latch prevents the
 * consent event and initial check from double-counting the same view.
 */
export function useConsentedPageView(page: Page | null, mailboxId: string | null = null): void {
  useEffect(() => {
    let emitted = false;
    const emit = () => {
      if (emitted || page === null || !hasAnalyticsConsent()) return;
      emitted = true;
      void track('page_viewed', { page, mailbox_id: mailboxId });
    };

    emit();
    window.addEventListener(CONSENT_CHANGE_EVENT, emit);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, emit);
  }, [page, mailboxId]);
}
