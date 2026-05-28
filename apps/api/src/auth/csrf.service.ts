import { randomBytes, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

/**
 * CSRF double-submit cookie (D155).
 *
 * The CSRF token is a random 32-byte URL-safe string returned in BOTH:
 *   - a non-HttpOnly cookie (`csrf_token`) the FE can read
 *   - a header (`X-CSRF-Token`) the FE attaches to mutating requests
 *
 * The `CsrfGuard` verifies the two match for any POST/PUT/PATCH/DELETE.
 * The non-HttpOnly cookie cannot be read cross-origin (browser SOP) so
 * an attacker site can forge neither half of the pair.
 *
 * The token rotates on every login. The same token is valid for the
 * life of the session — rotating per-request adds latency without
 * meaningfully changing the attack surface (CSRF needs cross-origin
 * read of `document.cookie`, which is already blocked).
 */

const CSRF_TOKEN_BYTES = 32;

@Injectable()
export class CsrfService {
  /** Generate a fresh CSRF token. Called once at session issue. */
  issue(): string {
    return randomBytes(CSRF_TOKEN_BYTES).toString('base64url');
  }

  /**
   * Constant-time comparison of cookie value against header value.
   * Returns false for any length mismatch, encoding issue, or
   * mismatched bytes.
   */
  verify(cookieValue: unknown, headerValue: unknown): boolean {
    if (typeof cookieValue !== 'string' || typeof headerValue !== 'string') return false;
    if (cookieValue.length !== headerValue.length) return false;
    const a = Buffer.from(cookieValue);
    const b = Buffer.from(headerValue);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
