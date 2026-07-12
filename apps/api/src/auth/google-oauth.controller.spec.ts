import type { Request, Response } from 'express';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RATE_LIMIT_METADATA,
  type RateLimitOptions,
} from '../common/rate-limit/rate-limit.types.js';
import type { SecurityEventsService } from '../security-events/security-events.service.js';
import type { AuthSignupOrchestrator } from './auth-signup.orchestrator.js';
import { BetaGateDeniedError } from './beta-gate.js';
import type { GoogleOAuthService } from './google-oauth.service.js';
import { GoogleOAuthController, parseBillingReturnTo } from './google-oauth.controller.js';

/** A SecurityEventsService stand-in with `record` as a spy. */
function makeSecurityEvents(): {
  service: SecurityEventsService;
  record: ReturnType<typeof vi.fn>;
} {
  const record = vi.fn().mockResolvedValue(undefined);
  return { service: { record } as unknown as SecurityEventsService, record };
}

/**
 * D156 rate-limit wiring on the Gmail OAuth connect routes.
 *
 * Both `start` and `callback` are unauthenticated pre-D109/D224 and
 * flag-gated by `GMAIL_CONNECT_ENABLED`. The original D156 review
 * (architecture-guardian gate on PR `feat/d009-sync-data-capture`)
 * flagged the absence of `@RateLimit('auth')` as a launch blocker the
 * moment the flag flips on in any public environment. PR #35 shipped
 * the decorator; this test guards against future removal.
 *
 * The runtime 429 behavior is exercised by
 * `rate-limit.interceptor.spec.ts` against the shared interceptor — this
 * test only verifies the route-level metadata is set to the `auth`
 * bucket so the interceptor sees it.
 */
describe('GoogleOAuthController — @RateLimit metadata (D156)', () => {
  const reflector = new Reflector();

  it('marks GET /start with the auth bucket', () => {
    const opts = reflector.get<RateLimitOptions>(
      RATE_LIMIT_METADATA,
      GoogleOAuthController.prototype.start,
    );
    expect(opts).toEqual({ bucket: 'auth' });
  });

  it('marks GET /callback with the auth bucket', () => {
    const opts = reflector.get<RateLimitOptions>(
      RATE_LIMIT_METADATA,
      GoogleOAuthController.prototype.callback,
    );
    expect(opts).toEqual({ bucket: 'auth' });
  });
});

describe('GoogleOAuthController.start — validated post-login billing intent', () => {
  it('stores only the canonical local billing destination in OAuth state', () => {
    const oauth = { getConsentUrl: vi.fn(() => 'https://accounts.google.test/consent') };
    const res = { cookie: vi.fn(), redirect: vi.fn() };
    const controller = new GoogleOAuthController(
      oauth as unknown as GoogleOAuthService,
      {} as AuthSignupOrchestrator,
      makeSecurityEvents().service,
    );

    controller.start(
      res as unknown as Response,
      '/billing?cycle=annual&promo=foundingPro&plan=pro',
    );

    const state = JSON.parse(res.cookie.mock.calls[0]?.[1] as string) as Record<string, unknown>;
    expect(state).toMatchObject({
      mode: 'login',
      returnTo: '/billing?plan=pro&cycle=annual&promo=foundingPro',
    });
    expect(state.nonce).toEqual(expect.any(String));
    expect(res.redirect).toHaveBeenCalledWith(302, 'https://accounts.google.test/consent');
  });

  it.each([
    'https://evil.example/billing?plan=pro&cycle=annual',
    '//evil.example/billing?plan=pro&cycle=annual',
    '/billing?plan=plus&cycle=annual&promo=foundingPro',
    '/billing?plan=pro&cycle=annual&next=/senders',
    '/billing?plan=pro&plan=plus&cycle=annual',
  ])('drops an unsafe or impossible returnTo: %s', (returnTo) => {
    const oauth = { getConsentUrl: vi.fn(() => 'https://accounts.google.test/consent') };
    const res = { cookie: vi.fn(), redirect: vi.fn() };
    const controller = new GoogleOAuthController(
      oauth as unknown as GoogleOAuthService,
      {} as AuthSignupOrchestrator,
      makeSecurityEvents().service,
    );

    controller.start(res as unknown as Response, returnTo);

    const state = JSON.parse(res.cookie.mock.calls[0]?.[1] as string) as Record<string, unknown>;
    expect(state).not.toHaveProperty('returnTo');
  });

  it('shares the strict validator with the callback trust boundary', () => {
    expect(parseBillingReturnTo('/billing?plan=plus&cycle=monthly')).toBe(
      '/billing?plan=plus&cycle=monthly',
    );
    expect(parseBillingReturnTo('/senders')).toBeUndefined();
  });
});

/**
 * Callback connect-mode redirect (D6, D109, D115, D116).
 *
 * A second Gmail connected via the authenticated connect-mailbox flow
 * must route through the sync gate (`/onboarding?mailbox=<id>`), NOT
 * land on an empty `/triage`. The `mailbox` query param is the gate's
 * explicit poll target so it survives the user switching back to their
 * primary mailbox.
 */
describe('GoogleOAuthController.callback — connect-mode routes to the sync gate', () => {
  const NONCE = 'nonce-value';
  let orchestrator: { addMailbox: ReturnType<typeof vi.fn> };
  let oauth: { exchangeCode: ReturnType<typeof vi.fn> };
  let securityEvents: ReturnType<typeof makeSecurityEvents>;
  let controller: GoogleOAuthController;
  let res: { clearCookie: ReturnType<typeof vi.fn>; redirect: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    orchestrator = { addMailbox: vi.fn().mockResolvedValue({ mailboxId: 'mailbox-new' }) };
    oauth = {
      exchangeCode: vi.fn().mockResolvedValue({ email: 'second@example.com', refreshToken: 'rt' }),
    };
    securityEvents = makeSecurityEvents();
    res = { clearCookie: vi.fn(), redirect: vi.fn() };
    controller = new GoogleOAuthController(
      oauth as unknown as GoogleOAuthService,
      orchestrator as unknown as AuthSignupOrchestrator,
      securityEvents.service,
    );
  });

  function reqWithState(): Request {
    return {
      cookies: {
        oauth_state: JSON.stringify({
          nonce: NONCE,
          mode: 'connect',
          userId: 'u-owner',
          workspaceId: 'w-home',
        }),
      },
      headers: {},
    } as unknown as Request;
  }

  it('redirects to /onboarding?mailbox=<id> after adding the mailbox', async () => {
    await controller.callback(reqWithState(), res as unknown as Response, 'auth-code', NONCE);

    expect(orchestrator.addMailbox).toHaveBeenCalledWith(
      expect.objectContaining({ currentUserId: 'u-owner', currentWorkspaceId: 'w-home' }),
    );
    const webBase = process.env.WEB_URL ?? 'http://localhost:3000';
    expect(res.redirect).toHaveBeenCalledWith(302, `${webBase}/onboarding?mailbox=mailbox-new`);
  });
});

/**
 * D181 — security-event emits on the OAuth callback. Every failure
 * branch records a `login.failure` with a controlled reason enum
 * BEFORE the original throw fires, and every success branch records
 * `login.success`. Behavior of the callback (status, throw type,
 * redirect target) is unchanged: the emit is additive and the
 * service is documented to swallow its own write failures, so a
 * failing audit insert must never alter the response.
 */
describe('GoogleOAuthController.callback — D181 security-event emits', () => {
  const NONCE = 'nonce-value';
  const IP = '203.0.113.7';
  const UA = 'curl/8';
  let orchestrator: {
    addMailbox: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
  };
  let oauth: { exchangeCode: ReturnType<typeof vi.fn> };
  let securityEvents: ReturnType<typeof makeSecurityEvents>;
  let controller: GoogleOAuthController;
  let res: {
    clearCookie: ReturnType<typeof vi.fn>;
    redirect: ReturnType<typeof vi.fn>;
    cookie: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    orchestrator = {
      addMailbox: vi.fn().mockResolvedValue({ mailboxId: 'mailbox-new' }),
      connect: vi.fn().mockResolvedValue({
        tokens: { accessToken: 'a', refreshToken: 'r', jti: 'j', refreshTokenHash: 'h' },
        csrfToken: 'csrf',
        user: { id: 'u-1', workspaceId: 'w-1', email: 'first@example.com' },
        mailbox: { id: 'mailbox-1' },
        isNewSignup: false,
      }),
    };
    oauth = {
      exchangeCode: vi.fn().mockResolvedValue({ email: 'first@example.com', refreshToken: 'rt' }),
    };
    securityEvents = makeSecurityEvents();
    res = { clearCookie: vi.fn(), redirect: vi.fn(), cookie: vi.fn() };
    controller = new GoogleOAuthController(
      oauth as unknown as GoogleOAuthService,
      orchestrator as unknown as AuthSignupOrchestrator,
      securityEvents.service,
    );
  });

  function req(
    opts: {
      cookies?: Record<string, string>;
      ip?: string;
      userAgent?: string;
    } = {},
  ): Request {
    return {
      cookies: opts.cookies ?? {},
      ip: opts.ip ?? IP,
      headers: { 'user-agent': opts.userAgent ?? UA },
    } as unknown as Request;
  }

  function loginCookie(nonce: string = NONCE, returnTo?: string): Record<string, string> {
    return {
      oauth_state: JSON.stringify({
        nonce,
        mode: 'login',
        ...(returnTo ? { returnTo } : {}),
      }),
    };
  }

  function connectCookie(
    nonce: string = NONCE,
    extras: Partial<{ userId: string; workspaceId: string }> = {
      userId: 'u-owner',
      workspaceId: 'w-home',
    },
  ): Record<string, string> {
    return { oauth_state: JSON.stringify({ nonce, mode: 'connect', ...extras }) };
  }

  it('records login.failure { reason: missing_state_cookie } and still throws BadRequest', async () => {
    await expect(
      controller.callback(req(), res as unknown as Response, 'code', NONCE),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(securityEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'login.failure',
        severity: 'warning',
        sourceIp: IP,
        userAgent: UA,
        payload: { provider: 'google', reason: 'missing_state_cookie' },
      }),
    );
  });

  it('records login.failure { reason: malformed_state_cookie } on bad JSON', async () => {
    await expect(
      controller.callback(
        req({ cookies: { oauth_state: 'not-json' } }),
        res as unknown as Response,
        'code',
        NONCE,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(securityEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { provider: 'google', reason: 'malformed_state_cookie' },
      }),
    );
  });

  it('records login.failure { reason: invalid_state } when nonces disagree', async () => {
    await expect(
      controller.callback(
        req({ cookies: loginCookie('nonce-A') }),
        res as unknown as Response,
        'code',
        'nonce-B',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(securityEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { provider: 'google', reason: 'invalid_state' },
      }),
    );
  });

  it('records login.failure { reason: missing_code }', async () => {
    await expect(
      controller.callback(
        req({ cookies: loginCookie() }),
        res as unknown as Response,
        undefined,
        NONCE,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(securityEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { provider: 'google', reason: 'missing_code' },
      }),
    );
  });

  it('records login.failure { reason: token_exchange_failed } and rethrows the original error', async () => {
    const upstream = new Error('Google: invalid_grant');
    oauth.exchangeCode.mockRejectedValueOnce(upstream);

    await expect(
      controller.callback(
        req({ cookies: loginCookie() }),
        res as unknown as Response,
        'code',
        NONCE,
      ),
    ).rejects.toBe(upstream);

    expect(securityEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { provider: 'google', reason: 'token_exchange_failed' },
      }),
    );
    // Sanity check: the controlled reason is the only payload field —
    // the raw upstream error message is never copied into the audit row.
    const call = securityEvents.record.mock.calls.find(
      ([arg]) =>
        (arg as { payload?: { reason?: string } }).payload?.reason === 'token_exchange_failed',
    );
    expect(call?.[0].payload).not.toHaveProperty('error');
    expect(JSON.stringify(call?.[0])).not.toContain('invalid_grant');
  });

  it('records login.failure { reason: connect_state_incomplete } when userId/workspaceId missing in connect-mode', async () => {
    await expect(
      controller.callback(
        req({ cookies: connectCookie(NONCE, {}) }),
        res as unknown as Response,
        'code',
        NONCE,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(securityEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { provider: 'google', reason: 'connect_state_incomplete' },
      }),
    );
  });

  it('records login.success { mode: connect } and redirects on a successful connect-mode callback', async () => {
    await controller.callback(
      req({ cookies: connectCookie() }),
      res as unknown as Response,
      'code',
      NONCE,
    );

    expect(securityEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'login.success',
        severity: 'info',
        userId: 'u-owner',
        workspaceId: 'w-home',
        payload: { provider: 'google', mode: 'connect' },
      }),
    );
    const webBase = process.env.WEB_URL ?? 'http://localhost:3000';
    expect(res.redirect).toHaveBeenCalledWith(302, `${webBase}/onboarding?mailbox=mailbox-new`);
  });

  it('records login.failure { reason: <code> } when addMailbox rejects with a structured ErrorCode', async () => {
    orchestrator.addMailbox.mockRejectedValueOnce({
      response: { code: 'MAILBOX_OWNED_BY_OTHER_WORKSPACE' },
      message: 'taken',
    });
    await controller.callback(
      req({ cookies: connectCookie() }),
      res as unknown as Response,
      'code',
      NONCE,
    );

    expect(securityEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'login.failure',
        payload: {
          provider: 'google',
          mode: 'connect',
          reason: 'MAILBOX_OWNED_BY_OTHER_WORKSPACE',
        },
      }),
    );
    const webBase = process.env.WEB_URL ?? 'http://localhost:3000';
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      `${webBase}/triage?connect_error=MAILBOX_OWNED_BY_OTHER_WORKSPACE`,
    );
  });

  it('records login.failure { reason: orchestrator_failed } when connect() throws and rethrows', async () => {
    const oops = new Error('db unavailable');
    orchestrator.connect.mockRejectedValueOnce(oops);

    await expect(
      controller.callback(
        req({ cookies: loginCookie() }),
        res as unknown as Response,
        'code',
        NONCE,
      ),
    ).rejects.toBe(oops);

    expect(securityEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { provider: 'google', reason: 'orchestrator_failed' },
      }),
    );
  });

  it('records login.success { mode: login, isNewSignup } on a successful login-mode callback', async () => {
    orchestrator.connect.mockResolvedValueOnce({
      tokens: { accessToken: 'a', refreshToken: 'r', jti: 'j', refreshTokenHash: 'h' },
      csrfToken: 'csrf',
      user: { id: 'u-99', workspaceId: 'w-99', email: 'new@example.com' },
      mailbox: { id: 'mailbox-99' },
      isNewSignup: true,
    });

    await controller.callback(
      req({ cookies: loginCookie() }),
      res as unknown as Response,
      'code',
      NONCE,
    );

    expect(securityEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'login.success',
        severity: 'info',
        userId: 'u-99',
        workspaceId: 'w-99',
        payload: { provider: 'google', mode: 'login', isNewSignup: true },
      }),
    );
  });

  it('returns an existing user to the exact validated billing choice', async () => {
    await controller.callback(
      req({
        cookies: loginCookie(NONCE, '/billing?plan=plus&cycle=monthly'),
      }),
      res as unknown as Response,
      'code',
      NONCE,
    );

    const webBase = process.env.WEB_URL ?? 'http://localhost:3000';
    expect(res.redirect).toHaveBeenCalledWith(302, `${webBase}/billing?plan=plus&cycle=monthly`);
  });

  it('finishes onboarding before returning a new signup to billing', async () => {
    orchestrator.connect.mockResolvedValueOnce({
      tokens: { accessToken: 'a', refreshToken: 'r', jti: 'j', refreshTokenHash: 'h' },
      csrfToken: 'csrf',
      user: { id: 'u-99', workspaceId: 'w-99', email: 'new@example.com' },
      mailbox: { id: 'mailbox-99' },
      isNewSignup: true,
    });

    await controller.callback(
      req({
        cookies: loginCookie(NONCE, '/billing?plan=pro&cycle=annual&promo=foundingPro'),
      }),
      res as unknown as Response,
      'code',
      NONCE,
    );

    const webBase = process.env.WEB_URL ?? 'http://localhost:3000';
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      `${webBase}/onboarding?returnTo=%2Fbilling%3Fplan%3Dpro%26cycle%3Dannual%26promo%3DfoundingPro`,
    );
  });

  it('ignores a forged callback returnTo instead of leaving the site', async () => {
    await controller.callback(
      req({
        cookies: loginCookie(NONCE, 'https://evil.example/billing?plan=pro&cycle=annual'),
      }),
      res as unknown as Response,
      'code',
      NONCE,
    );

    const webBase = process.env.WEB_URL ?? 'http://localhost:3000';
    expect(res.redirect).toHaveBeenCalledWith(302, `${webBase}/senders`);
  });

  it('turns a BetaGateDeniedError into a /beta redirect — signup.denied audit, no session, no throw', async () => {
    // Private-beta gate (F7): an uninvited brand-new signup. The
    // orchestrator throws BEFORE creating anything; the controller
    // must NOT bubble an error page — it records the audit row (with
    // the denied email, the founder's invite-list signal) and 302s to
    // the public waitlist page.
    orchestrator.connect.mockRejectedValueOnce(new BetaGateDeniedError());

    await expect(
      controller.callback(
        req({ cookies: loginCookie() }),
        res as unknown as Response,
        'code',
        NONCE,
      ),
    ).resolves.toBeUndefined();

    expect(securityEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'signup.denied',
        severity: 'info',
        sourceIp: IP,
        userAgent: UA,
        payload: {
          provider: 'google',
          reason: 'beta_gate_denied',
          email: 'first@example.com',
        },
      }),
    );
    const webBase = process.env.WEB_URL ?? 'http://localhost:3000';
    expect(res.redirect).toHaveBeenCalledWith(302, `${webBase}/beta?reason=not_invited`);
    // No session cookies for a denied signup.
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('does not alter the response when SecurityEventsService.record rejects', async () => {
    // Defense in depth — the service is documented to swallow its own
    // failures, but if a future refactor regresses that guarantee the
    // controller still treats the call as fire-and-forget (`void`).
    securityEvents.record.mockRejectedValue(new Error('audit insert lost'));

    await expect(
      controller.callback(
        req({ cookies: loginCookie() }),
        res as unknown as Response,
        'code',
        NONCE,
      ),
    ).resolves.toBeUndefined();
    const webBase = process.env.WEB_URL ?? 'http://localhost:3000';
    expect(res.redirect).toHaveBeenCalledWith(302, `${webBase}/senders`);
  });
});
