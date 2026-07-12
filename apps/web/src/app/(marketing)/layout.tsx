// Public marketing route group (D134, D198 context).
//
// Everything under `(marketing)` renders WITHOUT AuthProvider — no
// `GET /api/auth/me` round-trip, no auth skeleton, no OAuth bounce.
// The root layout still supplies fonts + tokens.css + the QueryClient,
// so marketing pages share the design language of the app.
//
// This shell also emits the site-wide structured data (D132 SEO
// batch): one JSON-LD graph with the Organization, the WebSite entity
// anchor, and the SoftwareApplication (offers derived from the D19 tier
// manifest — re-pricing there flows through here with no edit).
// Page-specific structured data (the landing FAQPage) lives with the
// page content.
//
// Server component on purpose: the shell itself cannot accidentally
// reach for `useAuth()`. Three narrow client islands remain explicit:
// route-family analytics, the layout-preserving mobile disclosure, and
// cookie consent.

import type { ReactNode } from 'react';
import { TIER_MANIFEST, tokens } from '@declutrmail/shared';

import { CookieConsentBanner } from '@/features/consent/cookie-consent-banner';
import { JsonLd } from '@/features/marketing/json-ld';
import { siteUrl } from '@/features/marketing/landing/urls';
import { PublicRouteTracker } from '@/features/marketing/public-route-tracker';
import { PublicFooter, PublicHeader } from '@/features/marketing/public-shell/public-shell';
import '@/features/marketing/public-shell/public-shell.css';

const { color, font } = tokens;

/**
 * One schema.org Offer per purchasable tier price point (D19 ladder).
 * The Founding Pro promo is deliberately excluded: it is a
 * limited-redemption price, and structured data has no way to expire
 * with the 250th redemption.
 */
function tierOffers() {
  return Object.values(TIER_MANIFEST)
    .filter((tier) => tier.purchasable)
    .flatMap((tier) =>
      (['monthly', 'annual'] as const).flatMap((cycle) => {
        const price = tier.prices[cycle];
        if (!price) return [];
        return [
          {
            '@type': 'Offer',
            name: price.usdCents === 0 ? tier.name : `${tier.name} — ${cycle}`,
            price: price.usdCents / 100,
            priceCurrency: 'USD',
            url: `${siteUrl()}/pricing`,
          },
        ];
      }),
    );
}

const ORGANIZATION_ID = `${siteUrl()}/#organization`;

const SITE_JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': ORGANIZATION_ID,
      name: 'DeclutrMail',
      url: siteUrl(),
      logo: `${siteUrl()}/icons/icon-512.png`,
      email: 'support@declutrmail.com',
    },
    {
      // Entity anchor for the site itself. No SearchAction — there is no
      // /search route, and fabricating one is a structured-data lie.
      '@type': 'WebSite',
      '@id': `${siteUrl()}/#website`,
      name: 'DeclutrMail',
      url: siteUrl(),
      inLanguage: 'en-US',
      publisher: { '@id': ORGANIZATION_ID },
    },
    {
      '@type': 'SoftwareApplication',
      name: 'DeclutrMail',
      url: siteUrl(),
      description: 'A Gmail sender-control companion with live previews and Activity undo.',
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Web',
      offers: tierOffers(),
      publisher: { '@id': ORGANIZATION_ID },
    },
  ],
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    // data-theme="light" PINS this public subtree to the light palette
    // regardless of the app preference — landing.css carries hardcoded
    // light-design hexes, so following the app's dark theme here would
    // produce seams. Token custom properties re-resolve at this node
    // (see [data-theme='light'] in @declutrmail/shared tokens.css).
    <div
      data-theme="light"
      style={{
        minHeight: '100vh',
        background: color.bg,
        color: color.fg,
        fontFamily: font.sans,
      }}
    >
      <JsonLd data={SITE_JSON_LD} />
      <PublicRouteTracker />
      <PublicHeader />
      <main id="main-content">{children}</main>
      <PublicFooter />
      {/* D147 consent ask — a small client island (the one JS addition
          this shell carries besides page-level islands). INSIDE the
          light-pinned <main> so the banner matches the marketing
          palette even when the app preference is dark. */}
      <CookieConsentBanner />
    </div>
  );
}
