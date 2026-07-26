'use client';

import { useEffect } from 'react';

import { captureAttribution } from '@/lib/attribution';
import { CONSENT_CHANGE_EVENT, hasAnalyticsConsent } from '@/lib/cookie-consent';
import { registerAttribution } from '@/lib/posthog';

/**
 * Record first-touch attribution once consent exists, and register it
 * as PostHog super properties.
 *
 * The consent listener is what makes this work in practice: a visitor
 * arriving on `/?utm_source=reddit` sees the banner BEFORE choosing, so
 * the capture on mount is a no-op. Accepting re-runs it while the
 * campaign parameters are still in the URL — without the listener, the
 * channel that produced the visit would be lost for every visitor who
 * did not already have consent stored.
 *
 * Both `captureAttribution` (create-only) and the local latch keep the
 * initial check and the consent event from doing the work twice.
 */
export function useAttributionCapture(): void {
  useEffect(() => {
    let captured = false;
    const capture = () => {
      if (captured || !hasAnalyticsConsent()) return;
      const attribution = captureAttribution();
      if (attribution === null) return;
      captured = true;
      void registerAttribution(attribution);
    };

    capture();
    window.addEventListener(CONSENT_CHANGE_EVENT, capture);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, capture);
  }, []);
}
