import { randomBytes, timingSafeEqual } from 'node:crypto';

import { BadRequestException, Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { RateLimit } from '../common/rate-limit/index.js';
import { GoogleOAuthService } from './google-oauth.service.js';

/** Name of the cookie that binds the OAuth `state` nonce to the caller. */
const STATE_COOKIE = 'oauth_state';

/** Cookie path — scoped to the connect routes only. */
const STATE_COOKIE_PATH = '/api/auth/google';

/**
 * Gmail OAuth connect routes (D4). Thin per D201 — each handler calls
 * exactly one service method.
 *
 *   GET /api/auth/google/start    → 302 to the Google consent screen
 *   GET /api/auth/google/callback → exchange code, persist, JSON result
 *
 * The whole feature module is imported by AppModule only when
 * `GMAIL_CONNECT_ENABLED=true` — the routes are unauthenticated until
 * the D109/D224 auth layer lands, so they do not exist unless the flag
 * is set.
 */
@Controller('auth/google')
export class GoogleOAuthController {
  constructor(private readonly oauth: GoogleOAuthService) {}

  @Get('start')
  @RateLimit('auth')
  start(@Res() res: Response): void {
    // CSRF: bind a random `state` nonce to the caller via an httpOnly
    // cookie; /callback rejects any code whose state doesn't match.
    const state = randomBytes(32).toString('base64url');
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax', // Lax so the cookie rides the top-level GET redirect back from Google.
      secure: process.env.NODE_ENV === 'production', // HTTPS-only in prod; off for local http dev.
      path: STATE_COOKIE_PATH,
      maxAge: 600_000, // 10 min — the consent window.
    });
    res.redirect(302, this.oauth.getConsentUrl(state));
  }

  @Get('callback')
  @RateLimit('auth')
  async callback(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
  ): Promise<{ data: { mailboxAccountId: string; email: string; status: string } }> {
    // CSRF check FIRST — before the code is exchanged.
    const cookieState: unknown = (req.cookies as Record<string, unknown> | undefined)?.[
      STATE_COOKIE
    ];
    if (!state || typeof cookieState !== 'string' || !statesMatch(state, cookieState)) {
      throw new BadRequestException('Invalid or missing OAuth state.');
    }
    if (!code) {
      throw new BadRequestException('Missing OAuth `code` query parameter.');
    }

    const result = await this.oauth.handleCallback(code);

    // State consumed — clear the cookie so it cannot be replayed.
    res.clearCookie(STATE_COOKIE, { path: STATE_COOKIE_PATH });

    // D202 success envelope: { data: ... }.
    return {
      data: {
        mailboxAccountId: result.mailboxAccountId,
        email: result.email,
        status: 'connected',
      },
    };
  }
}

/** Constant-time compare of the query `state` against the cookie value. */
function statesMatch(queryState: string, cookieState: string): boolean {
  const a = Buffer.from(queryState);
  const b = Buffer.from(cookieState);
  // timingSafeEqual requires equal length — a length mismatch is a reject.
  return a.length === b.length && timingSafeEqual(a, b);
}
