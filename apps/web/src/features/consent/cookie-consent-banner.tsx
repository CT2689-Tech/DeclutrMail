'use client';

import { useEffect, useState } from 'react';
import {
  CONSENT_CHANGE_EVENT,
  readStoredConsent,
  storeConsent,
  type CookieConsent,
} from '@/lib/cookie-consent';

import { CookieConsentBannerView } from './cookie-consent-banner-view';

/**
 * D147 cookie-consent banner — the single consent surface for optional
 * analytics (PostHog, D159).
 *
 * Copy is D147's, verbatim. Exactly two choices, styled with EQUAL
 * visual weight on purpose (no highlighted "accept", no buried
 * decline — the trust-wedge product doesn't dark-pattern its own
 * consent). The dismiss-X (2026-07-10) STORES the decline: ignoring
 * the banner was always equivalent to declining (nothing tracks until
 * "Accept all" is stored — `lib/cookie-consent.ts`, decline-by-
 * default), but the un-dismissable card floated over interactive UI
 * forever. Closing now persists 'essential' — the same
 * privacy-preserving outcome, without the permanent occlusion. The
 * choice remains changeable any time at /cookies and in Settings →
 * Privacy & data.
 *
 * Mounted once per surface group: the (marketing) layout, the (app)
 * layout, and the onboarding layout. Renders nothing server-side and
 * on the first client paint (storage is read post-mount, so hydration
 * never mismatches), then only while no choice is stored yet. After a
 * choice, the banner never returns (D147).
 */
export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const sync = () => setVisible(readStoredConsent() === null);
    sync();
    // A choice can also arrive from the D147 cookie-preferences card
    // mounted on the same page (/cookies, Settings → Privacy & data) — retire the ask
    // the moment ANY surface stores one.
    window.addEventListener(CONSENT_CHANGE_EVENT, sync);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, sync);
  }, []);

  if (!visible) return null;

  const choose = (choice: CookieConsent) => {
    storeConsent(choice);
    setVisible(false);
  };

  return <CookieConsentBannerView onChoose={choose} />;
}
