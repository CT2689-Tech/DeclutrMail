// 404 page (D167).
//
// Calm-branded, never apologetic — matches the D209 microcopy hard
// rule and the D2 cool/Vercel palette via shared tokens (Inter /
// JetBrains Mono / Fraunces are wired at the root layout — see
// layout.tsx). No new colours or fonts are introduced here; everything
// reads off `@declutrmail/shared`'s token surface.
//
// The page does NOT auto-fire a Sentry event — a 404 is an expected
// outcome (link rot, typed URLs) and would otherwise spam the
// dashboard. The 500 boundary (`error.tsx`) is where Sentry capture
// belongs (D167 + D170).
//
// Routing back is audience-aware (D140). A SIGNED-IN visitor is offered
// the app destinations — /triage (the daily ritual) + /senders (the
// directory). An ANONYMOUS visitor is offered marketing destinations —
// / (home) + /pricing — because /triage would only bounce them through
// a sign-in redirect. Audience is resolved by `NotFoundAudience`, a
// client island; see that file for why it is no longer read from the
// session cookie server-side.
//
// THIS FILE MUST STAY STATIC. Next treats the root not-found as part of
// every route's tree, so one per-request read here un-prerenders all 34
// public pages (Option A′; `prerender-static-routes.test.ts` guards it).

import type { Metadata } from 'next';

import { NotFoundAudience } from './not-found-audience';

export const metadata: Metadata = {
  title: 'Page not found — DeclutrMail',
  // Audience-neutral (the page serves both signed-in + anonymous
  // visitors, D140) — the mailbox reassurance is authed-only and lives
  // in the branched in-page body, not this shared meta tag.
  description: 'That link may be out of date, or the page may have moved.',
  // Belt-and-braces: 404s already return HTTP 404, but an explicit
  // noindex keeps soft-404 URL variants out of the index too.
  robots: { index: false },
};

/**
 * The 404 page — a STATIC server component (Option A′). It owns the
 * metadata and nothing else; the audience branch lives in the client
 * island so this file makes no per-request read. `NotFoundView` is
 * re-exported for the tests and stories that drive `authed` directly.
 */
export default function NotFound() {
  return <NotFoundAudience />;
}

export { NotFoundView } from './not-found-view';
