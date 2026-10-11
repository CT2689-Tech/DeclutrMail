import { type ExecutionContext, Inject, Injectable } from '@nestjs/common';

import { JwtGuard } from '../auth/jwt.guard.js';
import { JwtService } from '../auth/jwt.service.js';
import { SessionsService } from '../auth/sessions.service.js';

/**
 * Authenticate when a session cookie is present, and allow the request
 * through when it is not. A local copy so analytics does not import waitlist.
 */
@Injectable()
export class OptionalSessionGuard extends JwtGuard {
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
      return true;
    }
  }
}
