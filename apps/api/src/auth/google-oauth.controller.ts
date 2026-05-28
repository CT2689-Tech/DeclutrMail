import { randomBytes, timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { RateLimit } from '../common/rate-limit/index.js';
import { AuthSignupOrchestrator } from './auth-signup.orchestrator.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { CurrentUser, JwtGuard } from './jwt.guard.js';
import type { SessionPrincipal } from './sessions.service.js';
import { setSessionCookies } from './session-cookies.js';

/** Cookie carrying the OAuth state — nonce + post-callback intent. */
const STATE_COOKIE = 'oauth_state';
/** Cookie path — scoped to the connect routes only. */
const STATE_COOKIE_PATH = '/api/auth/google';

/**
 * What the state cookie carries between /start and /callback.
 *
 *   - `mode: 'login'`   — unauthenticated flow. Callback finds or
 *     creates the user/workspace and issues fresh session cookies.
 *   - `mode: 'connect'` — authenticated flow. Callback adds the Google
 *     account to the CURRENT user's workspace without creating a new
 *     user and without re-issuing cookies. `userId` + `workspaceId`
 *     are captured at /start time when the JwtGuard ran.
 */
interface OAuthState {
  nonce: string;
  mode: 'login' | 'connect';
  userId?: string;
  workspaceId?: string;
}

/**
 * Gmail OAuth connect routes (D4, D205).
 *
 *   GET /api/auth/google/start
 *     Unauthenticated. Begins signup / login. Callback issues session.
 *
 *   GET /api/auth/google/connect-mailbox/start
 *     Authenticated (JwtGuard). Begins "add another Gmail account to
 *     this workspace" flow. Callback ONLY upserts the mailbox; no new
 *     session is issued.
 *
 *   GET /api/auth/google/callback
 *     Single Google redirect target. Reads the state cookie's `mode`
 *     to branch between the two flows above.
 *
 * Thin per D201/D204 — each handler delegates to the orchestrator.
 */
@Controller('auth/google')
export class GoogleOAuthController {
  private readonly logger = new Logger(GoogleOAuthController.name);

  constructor(
    private readonly oauth: GoogleOAuthService,
    private readonly orchestrator: AuthSignupOrchestrator,
  ) {}

  @Get('start')
  @RateLimit('auth')
  start(@Res() res: Response): void {
    this.beginConsent(res, { nonce: randomBytes(32).toString('base64url'), mode: 'login' });
  }

  /**
   * Authenticated start: adds another Gmail account to the current
   * workspace. The state cookie carries `userId` + `workspaceId` so
   * the callback can verify the same browser still owns the session
   * AND knows which workspace to add the new mailbox to.
   */
  @Get('connect-mailbox/start')
  @RateLimit('auth')
  @UseGuards(JwtGuard)
  connectMailboxStart(@CurrentUser() user: SessionPrincipal, @Res() res: Response): void {
    this.beginConsent(res, {
      nonce: randomBytes(32).toString('base64url'),
      mode: 'connect',
      userId: user.userId,
      workspaceId: user.workspaceId,
    });
  }

  @Get('callback')
  @RateLimit('auth')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
  ): Promise<void> {
    const cookieRaw = (req.cookies as Record<string, unknown> | undefined)?.[STATE_COOKIE];
    if (typeof cookieRaw !== 'string') {
      throw new BadRequestException('Missing OAuth state cookie.');
    }
    let cookieState: OAuthState;
    try {
      cookieState = JSON.parse(cookieRaw) as OAuthState;
    } catch {
      throw new BadRequestException('Malformed OAuth state cookie.');
    }
    if (!state || !statesMatch(state, cookieState.nonce)) {
      throw new BadRequestException('Invalid OAuth state.');
    }
    if (!code) {
      throw new BadRequestException('Missing OAuth `code` query parameter.');
    }

    const { email, refreshToken } = await this.oauth.exchangeCode(code);
    // State consumed — clear the cookie so it cannot be replayed.
    res.clearCookie(STATE_COOKIE, { path: STATE_COOKIE_PATH });

    const webBase = process.env.WEB_URL ?? 'http://localhost:3000';

    if (cookieState.mode === 'connect') {
      // Authenticated connect-mailbox flow. The state cookie was
      // written by `connect-mailbox/start` which ran JwtGuard, so the
      // `userId`/`workspaceId` here trace back to a verified session.
      // We additionally trust the browser still owns the session
      // because: (a) the state cookie is HttpOnly + Secure + 10-min
      // TTL + path-scoped, so it cannot be forged from another origin;
      // (b) the orchestrator's cross-workspace ownership guard refuses
      // to silently move a Google account between workspaces.
      if (!cookieState.userId || !cookieState.workspaceId) {
        throw new UnauthorizedException('Connect-mailbox state cookie is incomplete.');
      }
      try {
        await this.orchestrator.addMailbox({
          currentUserId: cookieState.userId,
          currentWorkspaceId: cookieState.workspaceId,
          email,
          refreshToken,
        });
        res.redirect(302, `${webBase}/triage?connected=${encodeURIComponent(email)}`);
      } catch (err) {
        // Cross-workspace ownership refusal — bounce back with a flag
        // the FE can read into a toast.
        const message =
          err instanceof Error ? err.message : 'Failed to connect the additional mailbox.';
        this.logger.warn(`connect-mailbox failed for ${email}: ${message}`);
        const code =
          typeof (err as { response?: { code?: string } }).response?.code === 'string'
            ? (err as { response: { code: string } }).response.code
            : 'connect_failed';
        res.redirect(302, `${webBase}/triage?connect_error=${encodeURIComponent(code)}`);
      }
      return;
    }

    // Unauthenticated login / signup flow.
    const ipAddress = (req.ip ?? null) as string | null;
    const userAgent = (req.headers['user-agent'] ?? null) as string | null;
    const result = await this.orchestrator.connect({
      email,
      refreshToken,
      ipAddress,
      userAgent,
    });
    setSessionCookies(res, result.tokens, result.csrfToken);
    // New signups land on the onboarding sync gate (D6, D109) — it
    // polls real sync state and auto-advances to /senders once
    // readiness = ready. Returning users skip straight to /senders
    // (their sync is already done). Senders is the post-onboarding
    // home: it has real data immediately, whereas Triage is empty
    // until the scoring pipeline (D20/D25) runs. The gate route lives
    // at apps/web/src/app/onboarding/page.tsx.
    const target = result.isNewSignup ? `${webBase}/onboarding` : `${webBase}/senders`;
    res.redirect(302, target);
  }

  /**
   * Write the state cookie + redirect to Google consent. Shared by
   * both `start` paths.
   */
  private beginConsent(res: Response, state: OAuthState): void {
    res.cookie(STATE_COOKIE, JSON.stringify(state), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: STATE_COOKIE_PATH,
      maxAge: 600_000, // 10 min — the consent window.
    });
    res.redirect(302, this.oauth.getConsentUrl(state.nonce));
  }
}

/** Constant-time state comparison — same shape as the original. */
function statesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
