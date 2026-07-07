'use client';

import { useEffect, useState } from 'react';
import { Button, tokens } from '@declutrmail/shared';
import { readStoredConsent, storeConsent, type CookieConsent } from '@/lib/cookie-consent';

const { color, font, shadow } = tokens;

/**
 * D147 cookie-consent banner — the single consent surface for optional
 * analytics (PostHog, D159).
 *
 * Copy is D147's, verbatim. Exactly two choices, styled with EQUAL
 * visual weight on purpose (no highlighted "accept", no buried
 * decline — the trust-wedge product doesn't dark-pattern its own
 * consent). There is no dismiss-X: ignoring the banner is equivalent
 * to declining, because nothing tracks until "Accept all" is stored
 * (`lib/cookie-consent.ts` — decline-by-default), and the ask stays
 * visible until the visitor actually decides.
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
    setVisible(readStoredConsent() === null);
  }, []);

  if (!visible) return null;

  const choose = (choice: CookieConsent) => {
    storeConsent(choice);
    setVisible(false);
  };

  return (
    <section
      aria-label="Cookie consent"
      data-testid="cookie-consent-banner"
      style={{
        position: 'fixed',
        bottom: 16,
        left: 16,
        // Below ToastHost (200): an in-flight undo toast outranks
        // chrome. Above page content and the marketing masthead.
        zIndex: 150,
        maxWidth: 400,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background: color.card,
        border: `1px solid ${color.border}`,
        borderRadius: 10,
        boxShadow: shadow.pop,
        fontFamily: font.sans,
      }}
    >
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: color.fg }}>
        We use essential cookies for sign-in and billing.
      </p>
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: color.fgSoft }}>
        Help us improve DeclutrMail? We use PostHog to understand which features matter. We never
        see your inbox content.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="sm" tone="default" onClick={() => choose('all')}>
          Accept all
        </Button>
        <Button size="sm" tone="default" onClick={() => choose('essential')}>
          Essential only
        </Button>
      </div>
    </section>
  );
}
