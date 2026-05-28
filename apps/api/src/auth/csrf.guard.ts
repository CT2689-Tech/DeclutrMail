import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { CSRF_COOKIE } from './jwt.guard.js';
import { CsrfService } from './csrf.service.js';

/** Header the FE sends with the CSRF token on every state-changing request. */
export const CSRF_HEADER = 'x-csrf-token';

/**
 * Methods that mutate server state. Only these require CSRF; safe
 * methods (`GET`, `HEAD`, `OPTIONS`) are skipped because they cannot
 * have side effects per HTTP semantics, and the browser sends them
 * with credentials regardless.
 */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CsrfGuard (D155).
 *
 * Double-submit cookie pattern:
 *   - The CSRF token lives in a NON-HttpOnly cookie `dm_csrf` so the
 *     FE can read it via `document.cookie`.
 *   - The FE attaches the same value as the `X-CSRF-Token` header on
 *     mutating requests.
 *   - This guard compares them in constant time. A mismatch → 403.
 *
 * Cross-origin attackers cannot read the cookie value (browser SOP),
 * so they cannot construct a matching header. The cookie sails on the
 * request via SameSite=Lax for top-level navigation safety + the
 * header check blocks XHR-style CSRF.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly csrf: CsrfService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!MUTATING_METHODS.has(req.method)) {
      return true;
    }
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const cookieValue = cookies?.[CSRF_COOKIE];
    const headerValue = req.headers[CSRF_HEADER];
    if (!this.csrf.verify(cookieValue, headerValue)) {
      throw new ForbiddenException('CSRF token mismatch.');
    }
    return true;
  }
}
