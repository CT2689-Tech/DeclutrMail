import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';

import { JwtService } from './jwt.service.js';
import { SessionsService, type SessionPrincipal } from './sessions.service.js';

/** Cookie name carrying the 15-min access JWT (D155). */
export const ACCESS_COOKIE = 'dm_access';

/** Cookie name carrying the 30-day refresh JWT (D155). Strict SameSite. */
export const REFRESH_COOKIE = 'dm_refresh';

/** Cookie name carrying the CSRF double-submit token (D155). NON-HttpOnly. */
export const CSRF_COOKIE = 'dm_csrf';

/**
 * Read the access cookie out of an Express request. `cookieParser`
 * has already populated `req.cookies` per main.ts bootstrap.
 */
function getAccessCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const v = cookies?.[ACCESS_COOKIE];
  return typeof v === 'string' ? v : undefined;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by JwtGuard on successful auth. */
      user?: SessionPrincipal;
    }
  }
}

/**
 * JwtGuard (D155).
 *
 * Verifies the access JWT signature + expiration, then checks the
 * `active_sessions` row by jti to enforce revocation. Attaches the
 * principal to `req.user` for `@CurrentUser()` consumers.
 *
 * Returns 401 with the D202 error envelope on:
 *   - missing/malformed access cookie
 *   - signature failure
 *   - token kind != 'access'
 *   - expired token
 *   - session revoked or missing from `active_sessions`
 *
 * The client interprets 401 as "redirect to /api/auth/google/start"
 * (or, when an unexpired refresh cookie is present, "call /refresh
 * first"). See apps/web/src/lib/api/client.ts for the FE side.
 */
@Injectable()
export class JwtGuard implements CanActivate {
  private readonly logger = new Logger(JwtGuard.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = getAccessCookie(req);
    if (!token) {
      throw new UnauthorizedException('Missing session.');
    }

    let claims;
    try {
      claims = await this.jwt.verify(token, 'access');
    } catch (err) {
      this.logger.debug(`JWT verify failed: ${err instanceof Error ? err.message : err}`);
      throw new UnauthorizedException('Invalid or expired session.');
    }

    const row = await this.sessions.lookupByJti(claims.jti);
    if (!row) {
      throw new UnauthorizedException('Session revoked.');
    }

    req.user = {
      userId: claims.sub,
      workspaceId: claims.wsid,
      sessionId: claims.sid,
      jti: claims.jti,
    };
    return true;
  }
}

/**
 * `@CurrentUser()` — param decorator that pulls the authenticated
 * principal out of `req.user`. Only works inside routes guarded by
 * JwtGuard (or a guard that populates the same shape).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionPrincipal => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.user) {
      throw new UnauthorizedException('Route requires JwtGuard before resolving @CurrentUser().');
    }
    return req.user;
  },
);
