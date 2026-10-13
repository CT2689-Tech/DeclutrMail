'use client';

import { ANALYTICS_PRIVACY_CLAIM, Button, OVERLAY_Z, tokens } from '@declutrmail/shared';

const { color, font, shadow } = tokens;

/**
 * Presentational D147 banner. The stateful wrapper decides when it mounts;
 * this view is what actually paints, including in the 360px stacking check.
 */
export function CookieConsentBannerView({
  onChoose,
}: {
  onChoose: (choice: 'all' | 'essential') => void;
}) {
  return (
    <section
      aria-label="Cookie consent"
      data-testid="cookie-consent-banner"
      style={{
        position: 'fixed',
        bottom: 'calc(16px + var(--dm-tabbar-inset, 0px))',
        right: 16,
        // Below toasts, and below open modals (OVERLAY_Z.modal). An open
        // action sheet must keep its footer tappable. This layer stays
        // mounted, so the banner is reachable again once the dialog closes.
        zIndex: OVERLAY_Z.cookieBanner,
        width: 'calc(100vw - 32px)',
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
      <button
        type="button"
        aria-label="Close and continue with essential cookies only"
        onClick={() => onChoose('essential')}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 44,
          height: 44,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          background: 'transparent',
          color: color.fgMuted,
          fontSize: 14,
          lineHeight: 1,
          cursor: 'pointer',
          borderRadius: 6,
        }}
      >
        ×
      </button>
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: color.fg, paddingRight: 44 }}>
        We use essential cookies for sign-in and billing.
      </p>
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: color.fgSoft }}>
        Help us improve DeclutrMail? We use PostHog to understand which features matter.{' '}
        {ANALYTICS_PRIVACY_CLAIM}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          size="lg"
          tone="default"
          style={{ minHeight: 44, flex: 1 }}
          onClick={() => onChoose('all')}
        >
          Accept all
        </Button>
        <Button
          size="lg"
          tone="default"
          style={{ minHeight: 44, flex: 1 }}
          onClick={() => onChoose('essential')}
        >
          Essential only
        </Button>
      </div>
    </section>
  );
}
