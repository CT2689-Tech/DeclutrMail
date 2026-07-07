// Public marketing route group (D134, D198 context).
//
// Everything under `(marketing)` renders WITHOUT AuthProvider — no
// `GET /api/auth/me` round-trip, no auth skeleton, no OAuth bounce.
// The root layout still supplies fonts + tokens.css + the QueryClient,
// so marketing pages share the design language of the app.
//
// This file intentionally ships before any pages do: landing, legal
// and pricing land in later units. Keep this shell minimal — page-level
// chrome (nav, footer) belongs to those units, not here.
//
// Server component on purpose: no client JS is needed for a static
// public shell, and keeping it server-side guarantees no client hook
// can accidentally reach for `useAuth()` at the layout level.

import type { ReactNode } from 'react';
import { tokens } from '@declutrmail/shared';
import { CookieConsentBanner } from '@/features/consent/cookie-consent-banner';

const { color, font } = tokens;

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    // data-theme="light" PINS this public subtree to the light palette
    // regardless of the app preference — landing.css carries hardcoded
    // light-design hexes, so following the app's dark theme here would
    // produce seams. Token custom properties re-resolve at this node
    // (see [data-theme='light'] in @declutrmail/shared tokens.css).
    <main
      data-theme="light"
      style={{
        minHeight: '100vh',
        background: color.bg,
        color: color.fg,
        fontFamily: font.sans,
      }}
    >
      {children}
      {/* D147 consent ask — a small client island (the one JS addition
          this shell carries besides page-level islands). INSIDE the
          light-pinned <main> so the banner matches the marketing
          palette even when the app preference is dark. */}
      <CookieConsentBanner />
    </main>
  );
}
