import { BadRequestException, Body, Controller, Logger, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  nativeExchangeRequestSchema,
  ok,
  type Envelope,
  type NativeExchangeResponse,
} from '@declutrmail/shared/contracts';

import { RateLimit } from '../common/rate-limit/index.js';
import { SecurityEventsService } from '../security-events/security-events.service.js';
import { CsrfService } from './csrf.service.js';
import { NativeAuthService } from './native-auth.service.js';
import { SessionsService } from './sessions.service.js';
import { setSessionCookies } from './session-cookies.js';

/**
 * Native app sign-in, app side (ADR-0049).
 *
 *   POST /api/auth/native/exchange
 *
 * The system browser finished Google sign-in and handed the app a one-time
 * code. The app proves it started that flow by presenting the PKCE verifier,
 * and gets its own session cookies here, in its own WebView.
 *
 * Every failure is a 400, never a 401: the web client answers a 401 by
 * refreshing and then redirecting to login, which would restart the very
 * flow that just failed. The body says nothing about which check failed, so
 * a guess learns nothing; the cause goes to the audit log instead.
 */
@Controller('auth/native')
export class NativeAuthController {
  private readonly logger = new Logger(NativeAuthController.name);

  constructor(
    private readonly native: NativeAuthService,
    private readonly sessions: SessionsService,
    private readonly csrf: CsrfService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  @Post('exchange')
  @RateLimit('auth')
  async exchange(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ): Promise<Envelope<NativeExchangeResponse>> {
    // This route sets session cookies without one to protect, so it must not be
    // reachable by a cross-site form post that would sign the visitor in as
    // someone else. A JSON body cannot be sent cross-site without a CORS
    // preflight, and only the web origin passes it.
    if (!req.is('application/json')) throw closed();
    const parsed = nativeExchangeRequestSchema.safeParse(body);
    if (!parsed.success) throw closed();

    const ipAddress = req.ip ?? null;
    const userAgentHeader = req.headers['user-agent'];
    const userAgent = typeof userAgentHeader === 'string' ? userAgentHeader : null;
    const refuse = (reason: string, userId?: string): never => {
      void this.securityEvents.record({
        eventType: 'login.failure',
        severity: 'warning',
        sourceIp: ipAddress,
        userAgent,
        ...(userId ? { userId } : {}),
        payload: { provider: 'google', mode: 'native-exchange', reason },
      });
      throw closed();
    };

    // The code is spent here, before the verifier is looked at: whoever holds
    // a code without its verifier gets one guess, and it is not a free one.
    const ticket = await this.native.redeem('handoff', parsed.data.code);
    if (!ticket?.codeChallenge || !ticket.returnTo) return refuse('native_code_invalid');
    if (!NativeAuthService.verifierMatches(parsed.data.verifier, ticket.codeChallenge)) {
      return refuse('native_verifier_mismatch', ticket.userId);
    }

    const tokens = await this.sessions.issueForHandoff({
      sessionId: ticket.sessionId,
      ipAddress,
      userAgent,
    });
    if (!tokens) return refuse('native_session_gone', ticket.userId);

    setSessionCookies(res, tokens, this.csrf.issue());
    this.logger.log('Native sign-in handoff redeemed.');
    return ok({ returnTo: ticket.returnTo });
  }
}

function closed(): BadRequestException {
  return new BadRequestException('Sign-in could not be completed.');
}
