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

import {
  BETA_DENIED_PATH,
  BETA_DENIED_REASON,
  BETA_DENIED_REASON_PARAM,
} from '@declutrmail/shared/contracts';

import { RateLimit } from '../common/rate-limit/index.js';
import { SecurityEventsService } from '../security-events/security-events.service.js';
import { AuthSignupOrchestrator } from './auth-signup.orchestrator.js';
import { BetaGateDeniedError } from './beta-gate.js';
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
    private readonly securityEvents: SecurityEventsService,
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
    // Request metadata shared by every D181 emit in this handler. Captured
    // up-front because the failure emits below run before any per-flow
    // (login vs connect) branching.
    const ipAddress = (req.ip ?? null) as string | null;
    const userAgent = (req.headers['user-agent'] ?? null) as string | null;

    const cookieRaw = (req.cookies as Record<string, unknown> | undefined)?.[STATE_COOKIE];
    if (typeof cookieRaw !== 'string') {
      // D181: pre-orchestrator validation failure — no user/workspace
      // context yet, so the audit row is identified by ip/UA only.
      void this.securityEvents.record({
        eventType: 'login.failure',
        severity: 'warning',
        sourceIp: ipAddress,
        userAgent,
        payload: { provider: 'google', reason: 'missing_state_cookie' },
      });
      throw new BadRequestException('Missing OAuth state cookie.');
    }
    let cookieState: OAuthState;
    try {
      cookieState = JSON.parse(cookieRaw) as OAuthState;
    } catch {
      void this.securityEvents.record({
        eventType: 'login.failure',
        severity: 'warning',
        sourceIp: ipAddress,
        userAgent,
        payload: { provider: 'google', reason: 'malformed_state_cookie' },
      });
      throw new BadRequestException('Malformed OAuth state cookie.');
    }
    if (!state || !statesMatch(state, cookieState.nonce)) {
      void this.securityEvents.record({
        eventType: 'login.failure',
        severity: 'warning',
        sourceIp: ipAddress,
        userAgent,
        payload: { provider: 'google', reason: 'invalid_state' },
      });
      throw new BadRequestException('Invalid OAuth state.');
    }
    if (!code) {
      void this.securityEvents.record({
        eventType: 'login.failure',
        severity: 'warning',
        sourceIp: ipAddress,
        userAgent,
        payload: { provider: 'google', reason: 'missing_code' },
      });
      throw new BadRequestException('Missing OAuth `code` query parameter.');
    }

    let email: string;
    let refreshToken: string;
    try {
      ({ email, refreshToken } = await this.oauth.exchangeCode(code));
    } catch (err) {
      // Google rejected the exchange — wrong/expired code, mis-configured
      // OAuth client, or no refresh_token (already-consented account).
      // Reason is a closed enum; the underlying error message is never
      // copied into the payload (it can carry Google response detail).
      void this.securityEvents.record({
        eventType: 'login.failure',
        severity: 'warning',
        sourceIp: ipAddress,
        userAgent,
        payload: { provider: 'google', reason: 'token_exchange_failed' },
      });
      throw err;
    }
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
        void this.securityEvents.record({
          eventType: 'login.failure',
          severity: 'warning',
          sourceIp: ipAddress,
          userAgent,
          payload: { provider: 'google', reason: 'connect_state_incomplete' },
        });
        throw new UnauthorizedException('Connect-mailbox state cookie is incomplete.');
      }
      try {
        const { mailboxId } = await this.orchestrator.addMailbox({
          currentUserId: cookieState.userId,
          currentWorkspaceId: cookieState.workspaceId,
          email,
          refreshToken,
        });
        // D181 success emit — connect-mode adds a mailbox to an existing
        // session, so userId/workspaceId come from the verified cookie.
        void this.securityEvents.record({
          eventType: 'login.success',
          severity: 'info',
          userId: cookieState.userId,
          workspaceId: cookieState.workspaceId,
          sourceIp: ipAddress,
          userAgent,
          payload: { provider: 'google', mode: 'connect' },
        });
        // Route the freshly-connected mailbox through the sync gate
        // (D6 strict-gate-everywhere, D109) instead of dumping the user
        // on an empty /triage. addMailbox set it active, so the gate
        // resolves it via CurrentMailboxGuard; the `mailbox` param lets
        // the gate poll THIS mailbox explicitly even if the user later
        // switches back to their primary (D116 escape hatch).
        res.redirect(302, `${webBase}/onboarding?mailbox=${encodeURIComponent(mailboxId)}`);
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
        // D181 emit — the only payload field we trust is the controlled
        // `code` string extracted from the orchestrator's structured
        // error response (a closed `ErrorCode` enum); never the raw
        // `err.message`, which could carry caller-controlled data.
        void this.securityEvents.record({
          eventType: 'login.failure',
          severity: 'warning',
          userId: cookieState.userId,
          workspaceId: cookieState.workspaceId,
          sourceIp: ipAddress,
          userAgent,
          payload: { provider: 'google', mode: 'connect', reason: code },
        });
        res.redirect(302, `${webBase}/triage?connect_error=${encodeURIComponent(code)}`);
      }
      return;
    }

    // Unauthenticated login / signup flow.
    let result: Awaited<ReturnType<AuthSignupOrchestrator['connect']>>;
    try {
      result = await this.orchestrator.connect({
        email,
        refreshToken,
        ipAddress,
        userAgent,
      });
    } catch (err) {
      if (err instanceof BetaGateDeniedError) {
        // Private-beta invite gate (F7) — a brand-new signup without
        // an invite. Not a failure of the OAuth machinery: severity
        // info, and the user gets the public /beta waitlist page, not
        // an error. The denied email IS included in the audit payload
        // — it's the operational signal the founder acts on (add to
        // BETA_INVITE_EMAILS), it's a verified Google id_token claim
        // (not caller-controlled free text), and security_events is
        // the founder-only D181 surface — NOT telemetry, where raw
        // emails are banned (D159).
        void this.securityEvents.record({
          eventType: 'signup.denied',
          severity: 'info',
          sourceIp: ipAddress,
          userAgent,
          payload: { provider: 'google', reason: 'beta_gate_denied', email },
        });
        res.redirect(
          302,
          `${webBase}${BETA_DENIED_PATH}?${BETA_DENIED_REASON_PARAM}=${BETA_DENIED_REASON}`,
        );
        return;
      }
      // D181 emit — the orchestrator itself failed (DB outage during
      // user/workspace bootstrap, KMS unavailable, sync enqueue race
      // recovery exhausted, …). No verified userId/workspaceId to
      // attach; the reason enum is fixed.
      void this.securityEvents.record({
        eventType: 'login.failure',
        severity: 'warning',
        sourceIp: ipAddress,
        userAgent,
        payload: { provider: 'google', reason: 'orchestrator_failed' },
      });
      throw err;
    }
    setSessionCookies(res, result.tokens, result.csrfToken);
    // D181 emit — the orchestrator resolved the user; the audit row can
    // carry the verified userId/workspaceId and whether this was a new
    // signup vs returning user (a useful operator filter).
    void this.securityEvents.record({
      eventType: 'login.success',
      severity: 'info',
      userId: result.user.id,
      workspaceId: result.user.workspaceId,
      sourceIp: ipAddress,
      userAgent,
      payload: {
        provider: 'google',
        mode: 'login',
        isNewSignup: result.isNewSignup,
      },
    });
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
