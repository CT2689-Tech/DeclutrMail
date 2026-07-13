// Security headers + strict nonce-based CSP (D175).
//
// Every document request gets a fresh per-request nonce. The CSP is set
// on BOTH the request headers (so Next.js App Router picks the nonce up
// and stamps it onto its own framework <script> tags during dynamic
// rendering — see the root layout's `headers()` call, which forces every
// route dynamic so prerendered HTML can never ship a stale nonce) and
// the response headers (what the browser actually enforces).
//
// Pattern follows the official Next.js CSP guide:
// https://nextjs.org/docs/app/guides/content-security-policy
//
// Third-party allowlist (each entry traces to a vendor requirement):
//
//   PostHog (D159)   — posthog-js is bundled from npm (no remote
//     <script>), but it phones home (`/e`, `/decide`, `/array`) to the
//     ingest host and can lazy-load extension bundles from the PostHog
//     assets CDN (`us-assets.i.posthog.com`). `https://*.posthog.com`
//     covers both cloud hosts; the exact `NEXT_PUBLIC_POSTHOG_HOST`
//     origin is added too so a self-hosted/EU instance keeps working.
//   Sentry (D159)    — browser SDK is bundled; events go to the ingest
//     origin derived from `NEXT_PUBLIC_SENTRY_DSN` (connect-src only).
//     `https://*.sentry.io` matches the plan's allowlist and covers
//     `oXXXX.ingest.us.sentry.io` (CSP host wildcards span labels).
//   Paddle (D77/U13) — Paddle.js MUST load from `https://cdn.paddle.com/`
//     (https://developer.paddle.com/paddlejs/include-paddlejs); the
//     overlay checkout renders in iframes on `buy.paddle.com` /
//     `sandbox-buy.paddle.com` and calls `checkout-service.paddle.com`.
//     D175 allowlists the `https://*.paddle.com` umbrella for
//     frame-src / connect-src / form-action — those directives have no
//     `strict-dynamic`, so the iframe + API + form posts are authorized.
//     CAVEAT (U13 must handle): the `*.paddle.com` entry in SCRIPT-src is
//     a CSP2-only fallback — under `strict-dynamic` modern browsers
//     IGNORE host-source expressions in script-src, so a static
//     `<script src="cdn.paddle.com/...">` tag will be BLOCKED. U13 must
//     load Paddle.js via a nonced loader (next/script with the request
//     `x-nonce`) so trust propagates; the host entry alone is NOT enough.
//   Razorpay (D77/U13) — checkout script is `https://checkout.razorpay.com`;
//     the checkout iframe + API calls hit `https://api.razorpay.com`
//     (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/).
//     Same script-src/strict-dynamic caveat as Paddle: load
//     checkout.razorpay.com via a nonced loader, not a bare <script src>.
//     NOTE for U13: Razorpay's telemetry host `lumberjack.razorpay.com`
//     is intentionally NOT allowlisted — verify checkout still completes
//     (it should; telemetry is fire-and-forget) and widen connect-src
//     only if the overlay actually breaks.
//   Google avatars   — sender/account avatars come from
//     `https://*.googleusercontent.com` (lh3…lh6) per D175 (img-src).
//   Sender identity  — avatars are monogram-only per ADR-0024; sender
//     domains are never sent to third-party logo services.
//   Fonts            — next/font self-hosts Geist / Geist Mono /
//     Fraunces under `/_next/static/media` at build time, so font-src
//     stays `'self'` with no external font origin (verified: no
//     fonts.gstatic.com requests in the network tab).
//
// style-src DEVIATION FROM D175 (flagged for founder review, §3
// plan-drift): the plan says `style-src 'self' 'nonce-…'`, but CSP
// nonces only apply to <style>/<link> ELEMENTS — they cannot authorize
// inline `style=""` ATTRIBUTES (per the CSP3 spec), and the design
// system styles exclusively via inline token attributes (1000+
// `style={{…}}` usages across apps/web + packages/shared, server-rendered
// into the HTML). A nonce-only style-src renders every page unstyled.
// `style-src-attr 'unsafe-inline'` would be the precise fix but Firefox
// does not enforce/support the *-attr split reliably, so we ship
// `style-src 'self' 'unsafe-inline'`. The XSS-critical directive —
// script-src — remains fully strict (nonce + strict-dynamic, no
// unsafe-inline anywhere), which is the posture D175 actually exists to
// guarantee. Style-attribute injection without script execution is a
// far weaker primitive and is the standard accepted trade-off
// (web.dev/articles/strict-csp scopes strict CSP to scripts).
//
// Rollback escape hatch: set `CSP_REPORT_ONLY=true` (Vercel env) to flip
// the SAME policy to `Content-Security-Policy-Report-Only` — violations
// log to the browser console but nothing is blocked. Prod rollback is an
// env flip + redeploy, not a revert. Reports are deliberately not posted
// straight to a third party: native CSP payloads bypass the SDK privacy
// scrubber and can include full document/blocked URLs. A future first-party
// collector must normalize those fields before forwarding anything.
// Documented in .env.example.

import { NextResponse, type NextRequest } from 'next/server';

/** Origin of a URL-ish env var, or null when unset/garbage. */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    // Malformed env value — treat as unset rather than emitting a
    // broken CSP source that would invalidate the whole directive.
    return null;
  }
}

/** Space-joined source list with falsy entries dropped + de-duped. */
function sources(...entries: Array<string | null | false>): string {
  return [...new Set(entries.filter((e): e is string => Boolean(e)))].join(' ');
}

export interface CspEnv {
  isDev: boolean;
  apiUrl: string | undefined;
  posthogHost: string | undefined;
  sentryDsn: string | undefined;
}

/**
 * Build the D175 policy string for one request. Pure — exported for
 * unit tests; `middleware` below is the only runtime caller.
 */
export function buildContentSecurityPolicy(nonce: string, env: CspEnv): string {
  const apiOrigin = originOf(env.apiUrl);
  const posthogOrigin = originOf(env.posthogHost) ?? 'https://us.i.posthog.com';
  const sentryOrigin = originOf(env.sentryDsn);

  const directives = [
    `default-src 'self'`,
    // 'strict-dynamic' lets the nonced Next.js bootstrap scripts load
    // the chunk graph. The vendor host entries below are a CSP2-only
    // fallback: under strict-dynamic, CSP3 browsers IGNORE host-source
    // expressions in script-src, so a STATIC third-party <script src>
    // (Paddle.js, Razorpay checkout) is blocked — U13 must load those
    // via a nonced loader (see the Paddle/Razorpay header note). Dev
    // needs 'unsafe-eval' for React Refresh / eval source maps (per the
    // Next.js CSP guide) — production never includes it.
    `script-src ${sources(
      `'self'`,
      `'nonce-${nonce}'`,
      `'strict-dynamic'`,
      env.isDev && `'unsafe-eval'`,
      'https://*.paddle.com',
      'https://checkout.razorpay.com',
      'https://*.posthog.com',
      'https://*.sentry.io',
    )}`,
    // See header comment: attributes can't be nonced; design system is
    // inline-style based. script-src stays strict.
    `style-src 'self' 'unsafe-inline'`,
    // googleusercontent per D175; the last three are the sender-logo
    // chain in packages/shared avatar.tsx (see header comment).
    `img-src 'self' data: https://*.googleusercontent.com https://logo.clearbit.com https://icons.duckduckgo.com https://www.google.com`,
    `font-src 'self'`,
    `connect-src ${sources(
      `'self'`,
      apiOrigin,
      sentryOrigin,
      'https://*.sentry.io',
      posthogOrigin,
      'https://*.posthog.com',
      'https://*.paddle.com',
      'https://api.razorpay.com',
    )}`,
    `frame-src ${sources(
      'https://*.paddle.com',
      'https://checkout.razorpay.com',
      'https://api.razorpay.com',
    )}`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action ${sources(
      `'self'`,
      'https://*.paddle.com',
      'https://checkout.razorpay.com',
      'https://api.razorpay.com',
    )}`,
    `object-src 'none'`,
    // Prod-only: on http://localhost this would upgrade the API fetch
    // to https://localhost:4000 and break local dev.
    !env.isDev && `upgrade-insecure-requests`,
  ];

  return directives.filter((d): d is string => Boolean(d)).join('; ');
}

/**
 * Static (nonce-free) security headers, set on every matched response.
 *
 *  - nosniff: no MIME sniffing of responses.
 *  - Referrer-Policy: full referrer stays same-origin only.
 *  - Permissions-Policy: deny the sensor APIs nothing in the product
 *    needs. `payment` is intentionally NOT denied — the U13 Paddle /
 *    Razorpay checkout overlays may use the Payment Request API.
 *  - HSTS: 1 year + subdomains, preload OFF for now (D175 unit spec —
 *    preload is a one-way door; founder decision later). Browsers
 *    ignore the header over plain http, so localhost is unaffected.
 *  - X-Frame-Options: legacy mirror of `frame-ancestors 'none'`.
 */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), usb=()'],
  ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
  ['X-Frame-Options', 'DENY'],
];

/**
 * `CSP_REPORT_ONLY=true` → report-only header name, identical policy.
 * The escape hatch for a bad-CSP incident in prod: flip the env var,
 * redeploy, violations become console noise instead of breakage.
 * Anything but the literal "true" (incl. unset) means ENFORCING.
 */
export function cspHeaderName(reportOnlyFlag: string | undefined): string {
  return reportOnlyFlag === 'true'
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';
}

export function middleware(request: NextRequest): NextResponse {
  // 128 bits of webcrypto randomness, base64 — the canonical nonce
  // recipe from the Next.js CSP guide.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  const csp = buildContentSecurityPolicy(nonce, {
    isDev: process.env.NODE_ENV !== 'production',
    apiUrl: process.env.NEXT_PUBLIC_API_URL,
    posthogHost: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  });

  const headerName = cspHeaderName(process.env.CSP_REPORT_ONLY);

  // Request copy: Next.js reads the nonce out of this header and stamps
  // it on its own inline/framework scripts during SSR. `x-nonce` is the
  // documented channel for app code (next/script tags) to read it.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(headerName, csp);
  for (const [name, value] of STATIC_SECURITY_HEADERS) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  matcher: [
    // All routes except Next's static assets (immutable, no documents)
    // and prefetch requests (per the Next.js CSP guide — prefetched RSC
    // payloads are not documents; skipping them avoids burning nonces).
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
