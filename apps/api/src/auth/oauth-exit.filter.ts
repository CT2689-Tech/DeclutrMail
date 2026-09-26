import { Catch, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

import type { SignInResult } from '@declutrmail/shared/contracts';

import { AllExceptionsFilter } from '../common/all-exceptions.filter.js';
import { JwtService } from './jwt.service.js';
import { parseBillingReturnTo, STATE_COOKIE } from './oauth-browser.js';

/** Where a failed OAuth browser request lands. */
type OAuthExit = { mode: 'login'; returnTo: string | undefined } | { mode: 'connect' };

/**
 * The Google OAuth routes are full-page browser navigations (D108). A
 * failure on one lands on a page that says what happened, never on API
 * JSON a person cannot act on:
 *
 *   signing in       → /sign-in?auth_result=failed | rate_limited
 *   adding a mailbox → /settings?connect_start_result=failed | rate_limited
 *                      | session_retry
 *
 * Extends `AllExceptionsFilter` rather than replacing it, as
 * `IconErrorFilter` does: classification, the structured error log and the
 * 5xx Sentry capture are unchanged, so a sign-in outage still pages someone.
 * Only the bytes on the wire change.
 */
abstract class OAuthExitFilter extends AllExceptionsFilter {
  protected abstract exitFor(req: Request): OAuthExit;

  protected override respond(res: Response, status: number): void {
    // A handler that already answered cannot be redirected. The failure was
    // still logged, and captured if 5xx, before this point.
    if (res.headersSent) return;

    const webBase = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
    const exit = this.exitFor(res.req);
    if (exit.mode === 'connect') {
      const result =
        status === HttpStatus.TOO_MANY_REQUESTS
          ? 'rate_limited'
          : status === HttpStatus.UNAUTHORIZED
            ? 'session_retry'
            : 'failed';
      const query = new URLSearchParams({ connect_start_result: result });
      res.redirect(HttpStatus.FOUND, `${webBase}/settings?${query.toString()}#mailboxes`);
      return;
    }

    const result: SignInResult =
      status === HttpStatus.TOO_MANY_REQUESTS ? 'rate_limited' : 'failed';
    const query = new URLSearchParams({
      auth_result: result,
      ...(exit.returnTo ? { returnTo: exit.returnTo } : {}),
    });
    res.redirect(HttpStatus.FOUND, `${webBase}/sign-in?${query.toString()}`);
  }
}

/** `GET /auth/google/start` — always the signed-out sign-in. */
@Catch()
export class LoginStartExitFilter extends OAuthExitFilter {
  protected exitFor(req: Request): OAuthExit {
    return { mode: 'login', returnTo: parseBillingReturnTo(req.query?.returnTo) };
  }
}

/**
 * `GET /auth/google/callback` — the flow comes from the signed state
 * cookie. This only picks the landing page; whether the state is valid for
 * the callback is the handler's decision. A cookie that is missing or does
 * not verify lands on sign-in.
 */
@Catch()
@Injectable()
export class OAuthCallbackExitFilter extends OAuthExitFilter {
  // Explicit token: resolved the same way with or without emitted
  // decorator metadata (the test transpiler emits none).
  constructor(@Inject(JwtService) private readonly jwt: JwtService) {
    super();
  }

  protected exitFor(req: Request): OAuthExit {
    const raw = (req.cookies as Record<string, unknown> | undefined)?.[STATE_COOKIE];
    const payload = typeof raw === 'string' ? this.jwt.openOAuthState(raw) : null;
    let state: { mode?: unknown; returnTo?: unknown } | null = null;
    try {
      const parsed: unknown = payload ? JSON.parse(payload) : null;
      if (typeof parsed === 'object' && parsed !== null) state = parsed;
    } catch {
      state = null;
    }
    if (state?.mode === 'connect') return { mode: 'connect' };
    return { mode: 'login', returnTo: parseBillingReturnTo(state?.returnTo) };
  }
}
