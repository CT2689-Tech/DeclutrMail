import { Controller, Get, Logger, NotFoundException, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { RateLimit } from '../common/rate-limit/index.js';
import { UsersService } from '../users/users.service.js';
import { CsrfService } from './csrf.service.js';
import { SessionsService } from './sessions.service.js';
import { setSessionCookies } from './session-cookies.js';

/**
 * DEV-ONLY test login (D206 — smoke/e2e auth fixture).
 *
 * Issues a real session for an EXISTING user WITHOUT the Google OAuth
 * round-trip, so the preview browser / Playwright can reach the
 * authenticated app and exercise full flows (connect, disconnect,
 * switch, no-active, sync gate). It never creates a user and never
 * mints or touches OAuth tokens — it only calls `SessionsService.issue`
 * for an account that already exists.
 *
 * ⚠️ SECURITY: this is an authentication bypass. It is triple-gated and
 * MUST be unreachable in production:
 *   1. `NODE_ENV !== 'production'` (hard — prod is always 404).
 *   2. `DEV_AUTH_ENABLED === 'true'` (explicit opt-in; unset by default).
 *   3. the email matches `DEV_AUTH_EMAIL_PREFIX` (unset → NO email allowed).
 * Any miss → 404 (never reveal the route exists). `main.ts` additionally
 * refuses to boot if the prod + enabled combination is ever configured.
 */

/** True only when the dev login is explicitly enabled in a non-prod env. */
export function devAuthEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.DEV_AUTH_ENABLED === 'true';
}

/** Email allowlist — must match the configured prefix. Unset prefix → none. */
export function devAuthEmailAllowed(email: string): boolean {
  const prefix = process.env.DEV_AUTH_EMAIL_PREFIX;
  return typeof prefix === 'string' && prefix.length > 0 && email.startsWith(prefix);
}

@Controller('auth/dev')
export class DevAuthController {
  private readonly logger = new Logger(DevAuthController.name);

  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly csrf: CsrfService,
  ) {}

  /**
   * `GET /api/auth/dev/login?email=<allowlisted>` — issue a session and
   * redirect to the app. GET (not POST) so the preview can navigate to
   * it directly; acceptable because the route is dev-only, allowlisted,
   * and creates no state beyond a session for a known test account.
   */
  @Get('login')
  @RateLimit('auth')
  async login(
    @Query('email') email: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Triple gate — any miss is an indistinguishable 404.
    if (!devAuthEnabled()) throw new NotFoundException();
    if (!email || !devAuthEmailAllowed(email)) throw new NotFoundException();

    const user = await this.users.findByEmail(email);
    if (!user) throw new NotFoundException();

    const ipAddress = (req.ip ?? null) as string | null;
    const userAgent = (req.headers['user-agent'] ?? null) as string | null;
    const { tokens } = await this.sessions.issue({
      userId: user.userId,
      workspaceId: user.workspaceId,
      ipAddress,
      userAgent,
    });
    setSessionCookies(res, tokens, this.csrf.issue());
    this.logger.warn(`DEV login issued for ${email} (NODE_ENV=${process.env.NODE_ENV ?? 'unset'})`);

    const webBase = process.env.WEB_URL ?? 'http://localhost:3000';
    res.redirect(302, `${webBase}/senders`);
  }
}
