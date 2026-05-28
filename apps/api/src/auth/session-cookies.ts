import type { CookieOptions, Response } from 'express';

import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from './jwt.guard.js';
import type { IssuedTokens } from './jwt.service.js';

/**
 * Cookie helpers (D155).
 *
 * The three session cookies have intentionally different shapes:
 *
 *   - `dm_access`  HttpOnly, SameSite=Lax  — the access JWT. Lax so it
 *                  rides the top-level OAuth redirect from Google back
 *                  to /api/auth/google/callback.
 *   - `dm_refresh` HttpOnly, SameSite=Strict — the refresh JWT. Strict
 *                  because nothing else needs it cross-site, and it's
 *                  the bearer of long-term identity.
 *   - `dm_csrf`    NOT HttpOnly, SameSite=Lax — the CSRF token. Must
 *                  be readable by the FE so it can attach it as the
 *                  `X-CSRF-Token` header on mutating requests.
 *
 * `Secure` is true outside development so cookies do not leak over
 * plain HTTP. The cookie domain is configurable via `COOKIE_DOMAIN`
 * so prod sets `.declutrmail.com` and dev leaves it unset (defaults
 * to the request host).
 */

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

function cookieDomain(): string | undefined {
  return process.env.COOKIE_DOMAIN || undefined;
}

function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd(),
    domain: cookieDomain(),
    path: '/',
  };
}

/** Set all three session cookies after issue / rotate / first-login. */
export function setSessionCookies(res: Response, tokens: IssuedTokens, csrfToken: string): void {
  const base = baseOptions();
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    sameSite: 'lax',
    expires: tokens.accessExpiresAt,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    sameSite: 'strict',
    expires: tokens.refreshExpiresAt,
  });
  res.cookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: isProd(),
    sameSite: 'lax',
    domain: cookieDomain(),
    path: '/',
    expires: tokens.refreshExpiresAt,
  });
}

/** Clear the three session cookies on logout. */
export function clearSessionCookies(res: Response): void {
  const base = baseOptions();
  res.clearCookie(ACCESS_COOKIE, { ...base, sameSite: 'lax' });
  res.clearCookie(REFRESH_COOKIE, { ...base, sameSite: 'strict' });
  res.clearCookie(CSRF_COOKIE, {
    httpOnly: false,
    secure: isProd(),
    sameSite: 'lax',
    domain: cookieDomain(),
    path: '/',
  });
}
