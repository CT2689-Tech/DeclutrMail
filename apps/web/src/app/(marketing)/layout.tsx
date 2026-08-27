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
import { SignupRefCapture } from '@/features/marketing/signup-ref-capture';
import { ThemeScript } from '@/features/theme/theme-script';
import { softwareApplicationDescription } from './site-json-ld-description';
import '@/features/marketing/public-shell/public-shell.css';

const { color, font } = tokens;

/**
 * One schema.org Offer per purchasable tier price point (D19 ladder),
 * in every currency that point can ACTUALLY be bought in (D117).
 *
 * Enumerated rather than region-resolved on purpose. The pages
 * themselves quote the visitor's rail, so a single-currency graph would
 * disagree with the rendered price for half the world — but varying the
 * graph by request IP instead makes the structured data change between
 * crawls. Listing both is the only form that is true from every vantage
 * point, and it is exactly what schema.org's repeatable `offers` is for.
 *
 * INR appears only once `razorpayPlanId` is provisioned for that exact
 * point: advertising a price no checkout can take is the same lie in
 * structured data as it is on the page.
 *
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
        const name = price.usdCents === 0 ? tier.name : `${tier.name} — ${cycle}`;
        const offers = [
          {
            '@type': 'Offer',
            name,
            price: price.usdCents / 100,
            priceCurrency: 'USD',
            url: `${siteUrl()}/pricing`,
          },
        ];
        if (price.razorpayPlanId !== null) {
          offers.push({
            '@type': 'Offer',
            name,
            price: price.inrPaise / 100,
            priceCurrency: 'INR',
            url: `${siteUrl()}/pricing`,
          });
        }
        return offers;
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
      // ADR-0030: lead with the preview guarantee, keep the sender as the
      // mechanism. The previous string led with "sender-control", which is
      // the capability Gmail shipped natively in July 2025, and compressed
      // recovery into "Activity undo" — the shorthand that reads as
      // universal undo. This is the description an answer engine quotes,
      // so it carries the limits with the claim.
      description: softwareApplicationDescription,
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Web',
      offers: tierOffers(),
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
