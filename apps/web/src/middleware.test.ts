// Unit tests for the D175 CSP builder and request-level invariants
// (`src/middleware.ts`).
//
// Most coverage targets exported pure pieces: `buildContentSecurityPolicy`,
// `cspHeaderName`, and `STATIC_SECURITY_HEADERS`. The session ownership
// test also invokes middleware through `NextRequest`; full nonce stamping
// remains covered by the §8 browser smoke documented in the PR.

import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { AUTHED_APP_PATHS } from './app/robots';
import {
  STATIC_SECURITY_HEADERS,
  buildContentSecurityPolicy,
  cspHeaderName,
  isAuthedAppPath,
  middleware,
  type CspEnv,
} from './middleware';

const NONCE = 'dGVzdC1ub25jZQ==';

const PROD_ENV: CspEnv = {
  isDev: false,
  apiUrl: 'https://api.declutrmail.com',
  posthogHost: 'https://us.i.posthog.com',
  sentryDsn: 'https://abc123@o4501.ingest.us.sentry.io/4509',
};

/** Directive value by name, or undefined when the directive is absent. */
function directive(csp: string, name: string): string | undefined {
  return csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
}

describe('buildContentSecurityPolicy (D175)', () => {
  it('emits the strict script-src: self + nonce + strict-dynamic, no unsafe-inline', () => {
    const csp = buildContentSecurityPolicy(NONCE, PROD_ENV);
    const scriptSrc = directive(csp, 'script-src');

    expect(scriptSrc).toContain(`'nonce-${NONCE}'`);
    expect(scriptSrc).toContain(`'strict-dynamic'`);
    expect(scriptSrc).toContain(`'self'`);
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('unsafe-eval');
  });

  it('includes the D175 base directives', () => {
    const csp = buildContentSecurityPolicy(NONCE, PROD_ENV);

    expect(directive(csp, 'default-src')).toBe(`default-src 'self'`);
    expect(directive(csp, 'frame-ancestors')).toBe(`frame-ancestors 'none'`);
    expect(directive(csp, 'base-uri')).toBe(`base-uri 'self'`);
    expect(directive(csp, 'object-src')).toBe(`object-src 'none'`);
    expect(directive(csp, 'font-src')).toBe(`font-src 'self'`);
    // googleusercontent per D175 (Google profile photos). Brand logos
    // are first-party `/api/icons/:domain` (D254) — the retired
    // Clearbit/DuckDuckGo/Google S2 hosts must not stay on the policy.
    expect(directive(csp, 'img-src')).toBe(
      `img-src 'self' data: https://api.declutrmail.com https://*.googleusercontent.com`,
    );
    expect(directive(csp, 'img-src')).not.toContain('logo.clearbit.com');
    expect(directive(csp, 'img-src')).not.toContain('icons.duckduckgo.com');
    expect(directive(csp, 'img-src')).not.toContain('https://www.google.com');
  });

  // D254 regression. The brand-logo endpoint is a first-party
  // `${NEXT_PUBLIC_API_URL}/api/icons/:domain`, so the API origin must be
  // allowed for IMAGES, not only for XHR. These are separate CSP grants
  // and the bug shipped because only connect-src had it: locally the env
  // var is empty, the URL collapses to same-origin, `'self'` covers it,
  // and every local smoke passes while production refuses every logo.
  it('allows the API origin as an IMAGE source, not just a connect source (D254)', () => {
    const csp = buildContentSecurityPolicy(NONCE, PROD_ENV);

    expect(directive(csp, 'img-src')).toContain('https://api.declutrmail.com');
    expect(directive(csp, 'connect-src')).toContain('https://api.declutrmail.com');
  });

  // The same-origin collapse is exactly what hid the bug, so pin it:
  // with no API URL configured the directive must not sprout an empty or
  // malformed source — `'self'` is doing the work and that is correct.
  it('omits the API origin from img-src when the API is same-origin (D254)', () => {
    const csp = buildContentSecurityPolicy(NONCE, { ...PROD_ENV, apiUrl: undefined });
    const imgSrc = directive(csp, 'img-src');

    expect(imgSrc).toBe(`img-src 'self' data: https://*.googleusercontent.com`);
    expect(imgSrc).not.toContain('  ');
  });

  it('allowlists the billing + telemetry vendors per D175', () => {
    const csp = buildContentSecurityPolicy(NONCE, PROD_ENV);

    // Paddle: script + frame + connect + form-action (overlay checkout, U13).
    // NOTE: the *.paddle.com entry in SCRIPT-src is a CSP2-only fallback —
    // under 'strict-dynamic' (asserted above) modern browsers ignore it,
    // so U13 must load Paddle.js via a nonced loader. Presence here is
    // the host allowlist, NOT proof a static <script src> would execute.
    for (const dir of ['script-src', 'frame-src', 'connect-src', 'form-action']) {
      expect(directive(csp, dir)).toContain('https://*.paddle.com');
    }
    // Razorpay: checkout script + api.
    expect(directive(csp, 'script-src')).toContain('https://checkout.razorpay.com');
    expect(directive(csp, 'connect-src')).toContain('https://api.razorpay.com');
    expect(directive(csp, 'frame-src')).toContain('https://api.razorpay.com');
    // PostHog + Sentry.
    expect(directive(csp, 'connect-src')).toContain('https://*.posthog.com');
    expect(directive(csp, 'connect-src')).toContain('https://*.sentry.io');
  });

  // Regression for the production console report on /senders: Vercel
  // injected its toolbar frame and CSP blocked it, because frame-src
  // named only the two checkout vendors. The grant must stay exactly
  // this narrow — a wildcard, or a script/connect entry, would widen
  // the allowlist well past the one blocked iframe.
  it('allows the Vercel Toolbar frame origin and nothing wider', () => {
    const csp = buildContentSecurityPolicy(NONCE, PROD_ENV);

    expect(directive(csp, 'frame-src')).toContain('https://vercel.live');
    expect(directive(csp, 'frame-src')).not.toContain('https://*.vercel.live');
    expect(directive(csp, 'script-src')).not.toContain('vercel.live');
    expect(directive(csp, 'connect-src')).not.toContain('vercel.live');
  });

  it('derives connect-src origins from the env URLs (API + Sentry DSN)', () => {
    const csp = buildContentSecurityPolicy(NONCE, {
      ...PROD_ENV,
      apiUrl: 'https://api.declutrmail.com/api/auth/me',
      sentryDsn: 'https://key@o99.ingest.us.sentry.io/1',
    });
    const connectSrc = directive(csp, 'connect-src');

    // Origin only — path stripped.
    expect(connectSrc).toContain('https://api.declutrmail.com');
    expect(connectSrc).not.toContain('/api/auth/me');
    expect(connectSrc).toContain('https://o99.ingest.us.sentry.io');
  });

  it('never sends native CSP reports directly to a third party', () => {
    const csp = buildContentSecurityPolicy(NONCE, PROD_ENV);
    expect(directive(csp, 'report-uri')).toBeUndefined();
    expect(directive(csp, 'report-to')).toBeUndefined();
  });

  it('survives unset / malformed env URLs without emitting broken sources', () => {
    const csp = buildContentSecurityPolicy(NONCE, {
      isDev: false,
      apiUrl: 'not a url',
      posthogHost: undefined,
      sentryDsn: '',
    });
    const connectSrc = directive(csp, 'connect-src');

    expect(connectSrc).not.toContain('not a url');
    expect(connectSrc).not.toContain('null');
    expect(connectSrc).not.toContain('undefined');
    // PostHog falls back to the US cloud default.
    expect(connectSrc).toContain('https://us.i.posthog.com');
  });

  it('adds unsafe-eval ONLY in dev (React Refresh) and upgrade-insecure-requests ONLY in prod', () => {
    const prod = buildContentSecurityPolicy(NONCE, PROD_ENV);
    const dev = buildContentSecurityPolicy(NONCE, { ...PROD_ENV, isDev: true });

    expect(directive(prod, 'script-src')).not.toContain(`'unsafe-eval'`);
    expect(directive(dev, 'script-src')).toContain(`'unsafe-eval'`);
    expect(directive(prod, 'upgrade-insecure-requests')).toBe('upgrade-insecure-requests');
    expect(directive(dev, 'upgrade-insecure-requests')).toBeUndefined();
  });

  it('style-src is self + unsafe-inline (documented D175 deviation; never in script-src)', () => {
    const csp = buildContentSecurityPolicy(NONCE, PROD_ENV);
    expect(directive(csp, 'style-src')).toBe(`style-src 'self' 'unsafe-inline'`);
  });

  it('de-dupes a posthog host that matches the wildcard default shape', () => {
    const csp = buildContentSecurityPolicy(NONCE, PROD_ENV);
    const connectSrc = directive(csp, 'connect-src') ?? '';
    const occurrences = connectSrc.split('https://us.i.posthog.com').length - 1;
    expect(occurrences).toBe(1);
  });
});

/**
 * The public half of the Option A′ split (founder 2026-08-14).
 *
 * These assertions are the contract that keeps the concession BOUNDED:
 * 'unsafe-inline' is what buys prerendering, and it must appear on the
 * public policy only, in script-src only, and must never drag
 * 'strict-dynamic' or a nonce along with it.
 */
describe('buildContentSecurityPolicy — public (marketing) policy, Option A′', () => {
  it('trades the nonce for unsafe-inline and drops strict-dynamic', () => {
    const scriptSrc = directive(buildContentSecurityPolicy(null, PROD_ENV), 'script-src');

    expect(scriptSrc).toContain(`'unsafe-inline'`);
    expect(scriptSrc).toContain(`'self'`);
    // A nonce would make CSP2+ browsers IGNORE 'unsafe-inline', which
    // is precisely what a prerendered page cannot survive.
    expect(scriptSrc).not.toContain('nonce-');
    // Without strict-dynamic, host-sources apply again — that is what
    // authorizes /theme-init.js on this subtree.
    expect(scriptSrc).not.toContain(`'strict-dynamic'`);
    expect(scriptSrc).not.toContain(`'unsafe-eval'`);
  });

  it('confines the concession to script-src — every other directive is byte-identical', () => {
    const authed = buildContentSecurityPolicy(NONCE, PROD_ENV);
    const publicCsp = buildContentSecurityPolicy(null, PROD_ENV);
    const names = [
      'default-src',
      'style-src',
      'img-src',
      'font-src',
      'connect-src',
      'frame-src',
      'frame-ancestors',
      'base-uri',
      'form-action',
      'object-src',
      'upgrade-insecure-requests',
    ];

    for (const name of names) {
      expect(directive(publicCsp, name), `${name} must not differ between subtrees`).toBe(
        directive(authed, name),
      );
    }
  });

  it('still adds unsafe-eval in dev only', () => {
    expect(
      directive(buildContentSecurityPolicy(null, { ...PROD_ENV, isDev: true }), 'script-src'),
    ).toContain(`'unsafe-eval'`);
  });
});

describe('isAuthedAppPath — which subtree a request belongs to', () => {
  it('matches every authed path and their subroutes', () => {
    for (const path of AUTHED_APP_PATHS) {
      expect(isAuthedAppPath(path), path).toBe(true);
      expect(isAuthedAppPath(`${path}/nested/deep`), `${path}/…`).toBe(true);
    }
  });

  it('treats the public surface as public — including the two dynamic price pages', () => {
    for (const path of [
      '/',
      '/pricing',
      '/security',
      '/privacy',
      '/how-to/clean-gmail-by-sender',
      '/vs/unroll-me',
      '/blog/some-post',
      '/sign-in',
      '/some-404',
    ]) {
      expect(isAuthedAppPath(path), path).toBe(false);
    }
  });

  it('does not match a public path that merely PREFIXES an authed one', () => {
    // `/settings-guide` is not `/settings`. A substring match here would
    // hand a public page the strict policy and ship it dead once
    // prerendered.
    expect(isAuthedAppPath('/settings-guide')).toBe(false);
    expect(isAuthedAppPath('/billingx')).toBe(false);
  });
});

describe('authed document session handling', () => {
  it('leaves refresh-token rotation to the browser single-flight path', () => {
    const request = new NextRequest('https://app.declutrmail.com/senders', {
      headers: {
        cookie: 'dm_access=not-a-valid-jwt; dm_refresh=refresh-token',
      },
    });

    const response = middleware(request);

    expect(response).not.toBeInstanceOf(Promise);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});

describe('cspHeaderName (CSP_REPORT_ONLY escape hatch)', () => {
  it('is enforcing by default and report-only ONLY on the literal "true"', () => {
    expect(cspHeaderName(undefined)).toBe('Content-Security-Policy');
    expect(cspHeaderName('')).toBe('Content-Security-Policy');
    expect(cspHeaderName('false')).toBe('Content-Security-Policy');
    expect(cspHeaderName('TRUE')).toBe('Content-Security-Policy');
    expect(cspHeaderName('true')).toBe('Content-Security-Policy-Report-Only');
  });
});

describe('STATIC_SECURITY_HEADERS (D175)', () => {
  it('carries the full static set with expected values', () => {
    const map = new Map(STATIC_SECURITY_HEADERS);

    expect(map.get('X-Content-Type-Options')).toBe('nosniff');
    expect(map.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(map.get('X-Frame-Options')).toBe('DENY');
    // HSTS: 1 year + subdomains, preload OFF for now (one-way door).
    expect(map.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
    expect(map.get('Strict-Transport-Security')).not.toContain('preload');
    // Permissions-Policy must NOT deny `payment` (U13 checkout overlays).
    expect(map.get('Permissions-Policy')).toContain('camera=()');
    expect(map.get('Permissions-Policy')).not.toContain('payment');
  });
});
