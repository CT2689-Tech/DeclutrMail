// Unit tests for the D175 CSP builder (`src/middleware.ts`).
//
// The middleware function itself needs the Next.js edge runtime, so the
// suite targets the exported pure pieces: `buildContentSecurityPolicy`,
// `cspHeaderName`, and `STATIC_SECURITY_HEADERS`. The full
// request-level behavior (nonce on framework scripts, report-only flip)
// is covered by the §8 browser smoke documented in the PR.

import { describe, expect, it } from 'vitest';

import {
  STATIC_SECURITY_HEADERS,
  buildContentSecurityPolicy,
  cspHeaderName,
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
    // googleusercontent per D175 + the avatar.tsx sender-logo chain
    // (Clearbit → DuckDuckGo → Google S2), image-only origins.
    expect(directive(csp, 'img-src')).toBe(
      `img-src 'self' data: https://*.googleusercontent.com https://logo.clearbit.com https://icons.duckduckgo.com https://www.google.com`,
    );
  });

  it('allowlists the billing + telemetry vendors per D175', () => {
    const csp = buildContentSecurityPolicy(NONCE, PROD_ENV);

    // Paddle: script + frame + connect + form-action (overlay checkout, U13).
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
