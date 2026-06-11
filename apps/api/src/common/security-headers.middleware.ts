import type { NextFunction, Request, Response } from 'express';

/**
 * API security headers (D175) — helmet-equivalent minimal set.
 *
 * The API serves JSON (plus a handful of OAuth redirects), never
 * documents, so the header set is the standard API hardening profile
 * rather than helmet's full browser-page defaults:
 *
 *  - `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
 *    — an API response has no legitimate sub-resources; if one is ever
 *    coerced into rendering (content-type confusion, direct navigation
 *    to an endpoint), nothing can load and it cannot be framed. This is
 *    the OWASP-recommended CSP for REST APIs.
 *  - `X-Content-Type-Options: nosniff` — no MIME sniffing of JSON into
 *    something executable.
 *  - `X-Frame-Options: DENY` — legacy mirror of `frame-ancestors 'none'`.
 *  - `Referrer-Policy: strict-origin-when-cross-origin` — matches the
 *    web app's policy (src/middleware.ts in apps/web).
 *  - `Strict-Transport-Security` — 1 year + subdomains, preload OFF for
 *    now (one-way door; founder decision later, same as the web side).
 *    Production-only: browsers ignore HSTS over plain http anyway, and
 *    skipping it locally avoids pinning https onto localhost if the
 *    header ever leaks through a tunnel.
 *
 * Deliberately NOT set (helmet defaults we drop):
 *  - `Cross-Origin-*` isolation headers — meaningless for JSON, and
 *    CORP would need to agree with the CORS block (D179) for the
 *    cross-origin FE; the CORS middleware already owns that policy.
 *  - `X-XSS-Protection` — deprecated; helmet itself now sets it to `0`.
 *
 * Runs before CORS/routing so EVERY response — including 404s and the
 * D202 error envelope — carries the set.
 */
export const API_SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'"],
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
];

const HSTS_HEADER: readonly [string, string] = [
  'Strict-Transport-Security',
  'max-age=31536000; includeSubDomains',
];

export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
  for (const [name, value] of API_SECURITY_HEADERS) {
    res.setHeader(name, value);
  }
  if (process.env.NODE_ENV === 'production') {
    const [name, value] = HSTS_HEADER;
    res.setHeader(name, value);
  }
  next();
}
