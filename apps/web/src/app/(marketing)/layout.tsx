// Public marketing route group (D134, D198 context).
//
// Everything under `(marketing)` renders WITHOUT AuthProvider — no
// `GET /api/auth/me` round-trip, no auth skeleton, no OAuth bounce.
// The root layout still supplies fonts + tokens.css + the QueryClient,
// so marketing pages share the design language of the app.
//
// This shell also emits the site-wide structured data (D132 SEO
// batch): one JSON-LD graph with the Organization, the WebSite entity
// anchor, and the SoftwareApplication (offers from buildOffersJsonLd,
// empty until pricing v2 lists a plan).
// Page-specific structured data (e.g. the /faq and /help FAQPage) lives
// with the page content.
//
// Server component on purpose: the shell itself cannot accidentally
// reach for `useAuth()`. Four narrow client islands remain explicit:
// route-family analytics, cookieless page-view counts, the
// mobile navigation and theme controls, and cookie consent.

import type { ReactNode } from 'react';
import { tokens } from '@declutrmail/shared';
import { buildOffersJsonLd } from '@declutrmail/shared/entitlements';
import { ORGANIZATION_SAME_AS, WS3_COPY } from '@declutrmail/shared/copy/launch';

import { CookieConsentBanner } from '@/features/consent/cookie-consent-banner';
import { JsonLd } from '@/features/marketing/json-ld';
import { siteUrl } from '@/features/marketing/landing/urls';
import { PublicRouteTracker } from '@/features/marketing/public-route-tracker';
import { PublicFooter, PublicHeader } from '@/features/marketing/public-shell/public-shell';
import { SignupRefCapture } from '@/features/marketing/signup-ref-capture';
import { SiteAnalytics } from '@/features/marketing/site-analytics';
import { ThemeScript } from '@/features/theme/theme-script';
import { softwareApplicationDescription } from './site-json-ld-description';
import '@/features/marketing/public-shell/public-shell.css';

const { color, font } = tokens;

const ORGANIZATION_ID = `${siteUrl()}/#organization`;

const organization: Record<string, unknown> = {
  '@type': 'Organization',
  '@id': ORGANIZATION_ID,
  name: 'DeclutrMail',
  url: siteUrl(),
  logo: `${siteUrl()}/icons/icon-512.png`,
  email: 'support@declutrmail.com',
  disambiguatingDescription: WS3_COPY['ws3.jsonld.disambiguatingDescription'],
  alternateName: [...WS3_COPY['ws3.jsonld.alternateName']],
};

if (ORGANIZATION_SAME_AS.length > 0) {
  organization.sameAs = [...ORGANIZATION_SAME_AS];
}

const SITE_JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    organization,
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
      '@id': `${siteUrl()}/#software`,
      name: 'DeclutrMail',
      url: siteUrl(),
      // ADR-0030: lead with the preview guarantee, keep the sender as the
      // mechanism. The previous string led with "sender-control", which is
      // the capability Gmail shipped natively in July 2025, and compressed
      // recovery into "Activity undo" — the shorthand that reads as
      // universal undo. This is the description an answer engine quotes,
      // so it carries the limits with the claim.
      description: softwareApplicationDescription,
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Web',
      offers: buildOffersJsonLd(),
      publisher: { '@id': ORGANIZATION_ID },
    },
  ],
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* Un-nonced on purpose: this group's CSP is `script-src 'self'
          'unsafe-inline'` with NO 'strict-dynamic', so 'self' authorizes
          the same-origin asset by itself. A nonce here would be stale the
          moment the page is prerendered. Rendered ABOVE the wrapper div
          so it still executes before anything paints. */}
      <ThemeScript />
      <MarketingShell>{children}</MarketingShell>
    </>
  );
}

/**
 * NOTHING BELOW THIS POINT MAY READ `headers()`, `cookies()` OR
 * `searchParams` — that is what keeps 30+ public pages prerenderable
 * (Option A′). The two public pages that genuinely need per-request
 * state, `/` and `/pricing`, read it in the PAGE and stay dynamic.
 */
function MarketingShell({ children }: { children: ReactNode }) {
  return (
    // No data-theme pin: the public subtree follows the app preference,
    // resolved on <html> by theme-init.js before first paint. This node
    // previously forced light because landing.css held raw light hexes;
    // those were only ever the `--mkt-*` alias block, which now has a
    // dark counterpart, so every rule re-resolves from the aliases.
    // `color.bg` / `color.fg` are var(--dm-*) references, not literals.
    <div
      style={{
        minHeight: '100vh',
        background: color.bg,
        color: color.fg,
        fontFamily: font.sans,
      }}
    >
      <JsonLd data={SITE_JSON_LD} />
      <SignupRefCapture />
      <PublicRouteTracker />
      <SiteAnalytics />
      <PublicHeader />
      <main id="main-content">{children}</main>
      <PublicFooter />
      {/* D147 consent ask — a small client island (the one JS addition
          this shell carries besides page-level islands). Inside the
          shell so the banner inherits the same resolved theme as the
          rest of the marketing palette. */}
      <CookieConsentBanner />
    </div>
  );
}
