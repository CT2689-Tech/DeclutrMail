import { type ExecutionContext, Inject, Injectable } from '@nestjs/common';

import { JwtGuard } from '../auth/jwt.guard.js';
import { JwtService } from '../auth/jwt.service.js';
import { SessionsService } from '../auth/sessions.service.js';

/**
 * Authenticate when possible, never refuse.
 *
 * A valid session populates `req.user` exactly as `JwtGuard` does. A
 * missing, expired or revoked one lets the request through
 * ANONYMOUSLY, with `req.user` left undefined — which is the signal
 * `IconsController` reads to decide whether a cache miss may schedule
 * outbound work.
 *
 * WHY THIS EXISTS. `dm_access` lives 15 minutes and the web client
 * recovers from an expired one by rotating through
 * `POST /api/auth/refresh` and replaying the request
 * (`apps/web/src/lib/api/client.ts`). A CSS `background-image` cannot
 * do that: it is a browser subresource fetch with no code around it,
 * deliberately, because ADR-0034 makes `Avatar` a zero-JS server
 * component rendered hundreds of times per page. So on any visit after
 * the access token had aged out, every icon request 401'd while the
 * app's own calls silently refreshed and worked — a fully functional
 * page with no logos, permanently, since icons never retry
 * (incident 2026-08-16, founder decision same day).
 *
 * Scoped to `icons/` because that is its only consumer. Promote to
 * `auth/` if a second route ever needs it.
 */
@Injectable()
export class OptionalJwtGuard extends JwtGuard {
  // Explicit tokens: a subclass with no constructor of its own emits no
  // `design:paramtypes`, so Nest cannot resolve the inherited
  // dependencies by type — the same failure mode already documented on
  // `IconsController`.
  constructor(
    @Inject(JwtService) jwt: JwtService,
    @Inject(SessionsService) sessions: SessionsService,
  ) {
    super(jwt, sessions);
  }

  override async canActivate(ctx: ExecutionContext): Promise<boolean> {
    try {
      return await super.canActivate(ctx);
    } catch {
      // Every rejection reason collapses to "anonymous". The caller is
      // an image: it has no way to act on the difference between no
      // session, an expired one and a revoked one.
      return true;
    }
  }
}
