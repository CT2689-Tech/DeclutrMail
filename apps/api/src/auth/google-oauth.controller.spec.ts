import type { Request, Response } from 'express';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RATE_LIMIT_METADATA,
  type RateLimitOptions,
} from '../common/rate-limit/rate-limit.types.js';
import type { MailboxAccountsService } from '../mailboxes/mailbox-accounts.service.js';
import type { SecurityEventsService } from '../security-events/security-events.service.js';
import type { AuthSignupOrchestrator } from './auth-signup.orchestrator.js';
import { BetaGateDeniedError } from './beta-gate.js';
import type { GoogleOAuthService } from './google-oauth.service.js';
import { GoogleOAuthController, parseBillingReturnTo } from './google-oauth.controller.js';
import { JwtService } from './jwt.service.js';
import type { SessionPrincipal, SessionsService } from './sessions.service.js';

const RECONNECT_MAILBOX_ID = '11111111-1111-4111-8111-111111111111';
const RECONNECT_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECONNECT_WORKSPACE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONNECT_SESSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OTHER_WORKSPACE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const OTHER_SESSION_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const PRINCIPAL_JTI = '99999999-9999-4999-8999-999999999999';

function makeJwtService(): JwtService {
  const previousAccess = process.env.JWT_ACCESS_SECRET;
  const previousRefresh = process.env.JWT_REFRESH_SECRET;
  process.env.JWT_ACCESS_SECRET = 'oauth-state-test-access-secret-000000000001';
  process.env.JWT_REFRESH_SECRET = 'oauth-state-test-refresh-secret-00000000002';
  const jwt = new JwtService();
  if (previousAccess === undefined) delete process.env.JWT_ACCESS_SECRET;
  else process.env.JWT_ACCESS_SECRET = previousAccess;
  if (previousRefresh === undefined) delete process.env.JWT_REFRESH_SECRET;
  else process.env.JWT_REFRESH_SECRET = previousRefresh;
  return jwt;
}

function makeSessions(
  userId: string = RECONNECT_USER_ID,
  workspaceId: string = RECONNECT_WORKSPACE_ID,
): {
  service: SessionsService;
  lookupActiveById: ReturnType<typeof vi.fn>;
} {
  const lookupActiveById = vi
    .fn()
    .mockResolvedValue({ id: CONNECT_SESSION_ID, userId, workspaceId });
  return {
    service: { lookupActiveById } as unknown as SessionsService,
    lookupActiveById,
  };
}

function signedState(
  jwt: JwtService,
  state: Record<string, unknown>,
  expiresAt: number = Date.now() + 9 * 60 * 1000,
  issuedAt: number = Date.now(),
): string {
  return jwt.sealOAuthState(JSON.stringify({ ...state, issuedAt, expiresAt }));
}

function decodeSignedState(jwt: JwtService, cookie: string): Record<string, unknown> {
  const payload = jwt.openOAuthState(cookie);
  if (!payload) throw new Error('Expected an authenticated OAuth-state cookie.');
  return JSON.parse(payload) as Record<string, unknown>;
}

/** Change authenticated bytes without recomputing the HMAC. */
function tamperSignedState(cookie: string, field: string, value: unknown): string {
  const [version, encodedPayload, signature] = cookie.split('.');
  if (!version || !encodedPayload || !signature) throw new Error('Invalid test cookie.');
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
  payload[field] = value;
  return `${version}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;
}

function makeMailboxAccounts(): { findOwned: ReturnType<typeof vi.fn> } {
  return { findOwned: vi.fn() };
}

function activeReconnectTarget(
  overrides: Partial<{
    id: string;
    userId: string;
    workspaceId: string;
    status: 'active' | 'disconnected';
    providerAccountId: string;
  }> = {},
) {
  return {
    id: RECONNECT_MAILBOX_ID,
    userId: RECONNECT_USER_ID,
    workspaceId: RECONNECT_WORKSPACE_ID,
    status: 'active' as const,
    providerAccountId: 'second@example.com',
    ...overrides,
  };
}

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
    const jwt = makeJwtService();
    const controller = new GoogleOAuthController(
      oauth as unknown as GoogleOAuthService,
      {} as AuthSignupOrchestrator,
      makeSecurityEvents().service,
      makeMailboxAccounts() as unknown as MailboxAccountsService,
      jwt,
      makeSessions().service,
    );

    controller.start(
      res as unknown as Response,
      '/billing?cycle=annual&promo=foundingPro&plan=pro',
    );

    const state = decodeSignedState(jwt, res.cookie.mock.calls[0]?.[1] as string);
    expect(state).toMatchObject({
      mode: 'login',
      returnTo: '/billing?plan=pro&cycle=annual&promo=foundingPro',
    });
    expect(state.nonce).toEqual(expect.any(String));
    expect((state.expiresAt as number) - (state.issuedAt as number)).toBe(10 * 60 * 1000);
    expect(res.cookie.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/api/auth/google',
        maxAge: 10 * 60 * 1000,
      }),
    );
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
    const jwt = makeJwtService();
    const controller = new GoogleOAuthController(
      oauth as unknown as GoogleOAuthService,
      {} as AuthSignupOrchestrator,
      makeSecurityEvents().service,
      makeMailboxAccounts() as unknown as MailboxAccountsService,
      jwt,
      makeSessions().service,
    );

    controller.start(res as unknown as Response, returnTo);

    const state = decodeSignedState(jwt, res.cookie.mock.calls[0]?.[1] as string);
    expect(state).not.toHaveProperty('returnTo');
  });

  it('shares the strict validator with the callback trust boundary', () => {
    expect(parseBillingReturnTo('/billing?plan=plus&cycle=monthly')).toBe(
      '/billing?plan=plus&cycle=monthly',
    );
    expect(parseBillingReturnTo('/senders')).toBeUndefined();
    expect(parseBillingReturnTo(['/billing?plan=plus&cycle=monthly'])).toBeUndefined();
  });
});

describe('GoogleOAuthController.connectMailboxStart — targeted reconnect', () => {
  const principal: SessionPrincipal = {
    userId: RECONNECT_USER_ID,
    workspaceId: RECONNECT_WORKSPACE_ID,
    sessionId: CONNECT_SESSION_ID,
    jti: PRINCIPAL_JTI,
  };
  let oauth: { getConsentUrl: ReturnType<typeof vi.fn> };
  let mailboxes: ReturnType<typeof makeMailboxAccounts>;
  let jwt: JwtService;
  let controller: GoogleOAuthController;
  let res: { cookie: ReturnType<typeof vi.fn>; redirect: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    oauth = { getConsentUrl: vi.fn(() => 'https://accounts.google.test/consent') };
    mailboxes = makeMailboxAccounts();
    jwt = makeJwtService();
    res = { cookie: vi.fn(), redirect: vi.fn() };
    controller = new GoogleOAuthController(
      oauth as unknown as GoogleOAuthService,
      {} as AuthSignupOrchestrator,
      makeSecurityEvents().service,
      mailboxes as unknown as MailboxAccountsService,
      jwt,
      makeSessions().service,
    );
  });

  it('binds a syntactically valid owned active target into OAuth state', async () => {
    mailboxes.findOwned.mockResolvedValueOnce(activeReconnectTarget());

    await controller.connectMailboxStart(
      principal,
      res as unknown as Response,
      RECONNECT_MAILBOX_ID,
    );

    expect(mailboxes.findOwned).toHaveBeenCalledWith(RECONNECT_WORKSPACE_ID, RECONNECT_MAILBOX_ID);
    const state = decodeSignedState(jwt, res.cookie.mock.calls[0]?.[1] as string);
    expect(state).toMatchObject({
      mode: 'connect',
      userId: RECONNECT_USER_ID,
      workspaceId: RECONNECT_WORKSPACE_ID,
      sessionId: CONNECT_SESSION_ID,
      reconnectMailboxId: RECONNECT_MAILBOX_ID,
    });
    expect(res.redirect).toHaveBeenCalledWith(302, 'https://accounts.google.test/consent');
  });

  it('rejects a malformed target before any database read or consent redirect', async () => {
    await expect(
      controller.connectMailboxStart(principal, res as unknown as Response, 'not-a-uuid'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mailboxes.findOwned).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['disconnected', activeReconnectTarget({ status: 'disconnected' })],
    ['owned by another user', activeReconnectTarget({ userId: OTHER_USER_ID })],
  ])('rejects a %s target without starting consent', async (_label, target) => {
    mailboxes.findOwned.mockResolvedValueOnce(target);

    await expect(
      controller.connectMailboxStart(principal, res as unknown as Response, RECONNECT_MAILBOX_ID),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('keeps normal connect state unchanged when no reconnect target is supplied', async () => {
    await controller.connectMailboxStart(principal, res as unknown as Response);

    expect(mailboxes.findOwned).not.toHaveBeenCalled();
    const state = decodeSignedState(jwt, res.cookie.mock.calls[0]?.[1] as string);
    expect(state).not.toHaveProperty('reconnectMailboxId');
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
  let mailboxes: ReturnType<typeof makeMailboxAccounts>;
  let securityEvents: ReturnType<typeof makeSecurityEvents>;
  let jwt: JwtService;
  let sessions: ReturnType<typeof makeSessions>;
  let controller: GoogleOAuthController;
  let res: { clearCookie: ReturnType<typeof vi.fn>; redirect: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    orchestrator = { addMailbox: vi.fn().mockResolvedValue({ mailboxId: 'mailbox-new' }) };
    oauth = {
      exchangeCode: vi.fn().mockResolvedValue({ email: 'second@example.com', refreshToken: 'rt' }),
    };
    securityEvents = makeSecurityEvents();
    mailboxes = makeMailboxAccounts();
    jwt = makeJwtService();
    sessions = makeSessions();
    res = { clearCookie: vi.fn(), redirect: vi.fn() };
    controller = new GoogleOAuthController(
      oauth as unknown as GoogleOAuthService,
      orchestrator as unknown as AuthSignupOrchestrator,
      securityEvents.service,
      mailboxes as unknown as MailboxAccountsService,
      jwt,
      sessions.service,
    );
  });

  function reqWithState(reconnectMailboxId?: string): Request {
    return {
      cookies: {
        oauth_state: signedState(jwt, {
          nonce: NONCE,
          mode: 'connect',
          userId: RECONNECT_USER_ID,
          workspaceId: RECONNECT_WORKSPACE_ID,
          sessionId: CONNECT_SESSION_ID,
          ...(reconnectMailboxId ? { reconnectMailboxId } : {}),
        }),
      },
      headers: {},
    } as unknown as Request;
  }

  it('redirects to /onboarding?mailbox=<id> after adding the mailbox', async () => {
    await controller.callback(reqWithState(), res as unknown as Response, 'auth-code', NONCE);

    expect(orchestrator.addMailbox).toHaveBeenCalledWith(
      expect.objectContaining({
        currentUserId: RECONNECT_USER_ID,
        currentWorkspaceId: RECONNECT_WORKSPACE_ID,
      }),
    );
    const webBase = process.env.WEB_URL ?? 'http://localhost:3000';
    expect(res.redirect).toHaveBeenCalledWith(302, `${webBase}/onboarding?mailbox=mailbox-new`);
  });

  it('revalidates and completes a targeted reconnect using the stored canonical email', async () => {
    mailboxes.findOwned.mockResolvedValueOnce(activeReconnectTarget());
    oauth.exchangeCode.mockResolvedValueOnce({
      email: ' SECOND@example.com ',
      refreshToken: 'fresh-rt',
    });

    await controller.callback(
      reqWithState(RECONNECT_MAILBOX_ID),
      res as unknown as Response,
      'auth-code',
      NONCE,
    );

    expect(orchestrator.addMailbox).toHaveBeenCalledWith({
      currentUserId: RECONNECT_USER_ID,
      currentWorkspaceId: RECONNECT_WORKSPACE_ID,
      email: 'second@example.com',
      refreshToken: 'fresh-rt',
    });
    const webBase = process.env.WEB_URL ?? 'http://localhost:3000';
    expect(res.redirect).toHaveBeenCalledWith(302, `${webBase}/onboarding?mailbox=mailbox-new`);
  });

  it('does not mutate when Google returns a different account than the bound target', async () => {
    mailboxes.findOwned.mockResolvedValueOnce(activeReconnectTarget());
    oauth.exchangeCode.mockResolvedValueOnce({ email: 'other@example.com', refreshToken: 'rt' });

    await controller.callback(
      reqWithState(RECONNECT_MAILBOX_ID),
      res as unknown as Response,
      'auth-code',
      NONCE,
    );

    expect(orchestrator.addMailbox).not.toHaveBeenCalled();
    expect(securityEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'login.failure',
        userId: RECONNECT_USER_ID,
        workspaceId: RECONNECT_WORKSPACE_ID,
        payload: {
          provider: 'google',
          mode: 'connect',
          reason: 'reconnect_account_mismatch',
        },
      }),
    );
    expect(JSON.stringify(securityEvents.record.mock.calls.at(-1)?.[0])).not.toContain(
      'other@example.com',
    );
    const webBase = process.env.WEB_URL ?? 'http://localhost:3000';
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      `${webBase}/triage?connect_error=reconnect_account_mismatch`,
    );
  });

  it('does not mutate when the bound target is no longer valid at callback time', async () => {
    mailboxes.findOwned.mockResolvedValueOnce(null);

    await controller.callback(
      reqWithState(RECONNECT_MAILBOX_ID),
      res as unknown as Response,
      'auth-code',
      NONCE,
    );

    expect(orchestrator.addMailbox).not.toHaveBeenCalled();
    expect(securityEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          provider: 'google',
          mode: 'connect',
          reason: 'reconnect_target_invalid',
        },
      }),
    );
    const webBase = process.env.WEB_URL ?? 'http://localhost:3000';
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      `${webBase}/triage?connect_error=reconnect_target_invalid`,
    );
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
  let jwt: JwtService;
  let sessions: ReturnType<typeof makeSessions>;
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
    jwt = makeJwtService();
    sessions = makeSessions();
    res = { clearCookie: vi.fn(), redirect: vi.fn(), cookie: vi.fn() };
    controller = new GoogleOAuthController(
      oauth as unknown as GoogleOAuthService,
      orchestrator as unknown as AuthSignupOrchestrator,
      securityEvents.service,
      makeMailboxAccounts() as unknown as MailboxAccountsService,
      jwt,
      sessions.service,
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
      oauth_state: signedState(jwt, {
        nonce,
        mode: 'login',
        ...(returnTo ? { returnTo } : {}),
      }),
    };
  }

  function connectCookie(
    nonce: string = NONCE,
    extras: Partial<{ userId: string; workspaceId: string; sessionId: string }> = {
      userId: RECONNECT_USER_ID,
      workspaceId: RECONNECT_WORKSPACE_ID,
      sessionId: CONNECT_SESSION_ID,
    },
  ): Record<string, string> {
    return { oauth_state: signedState(jwt, { nonce, mode: 'connect', ...extras }) };
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

  it('records one invalid-state-cookie reason for malformed or unauthenticated input', async () => {
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
        payload: { provider: 'google', reason: 'invalid_state_cookie' },
      }),
    );
    expect(res.clearCookie).toHaveBeenCalledWith('oauth_state', { path: '/api/auth/google' });
    expect(sessions.lookupActiveById).not.toHaveBeenCalled();
    expect(oauth.exchangeCode).not.toHaveBeenCalled();
    expect(orchestrator.addMailbox).not.toHaveBeenCalled();
    expect(orchestrator.connect).not.toHaveBeenCalled();
  });

  it.each([
    ['mode', 'login'],
    ['userId', '22222222-2222-4222-8222-222222222222'],
    ['workspaceId', '33333333-3333-4333-8333-333333333333'],
    ['sessionId', OTHER_SESSION_ID],
    ['reconnectMailboxId', '22222222-2222-4222-8222-222222222222'],
    ['nonce', 'attacker-nonce'],
    ['expiresAt', Date.now() + 60 * 60 * 1000],
  ])('rejects HMAC tampering of %s before any authority is used', async (field, value) => {
    const authentic = signedState(jwt, {
      nonce: NONCE,
      mode: 'connect',
      userId: RECONNECT_USER_ID,
      workspaceId: RECONNECT_WORKSPACE_ID,
      sessionId: CONNECT_SESSION_ID,
      reconnectMailboxId: RECONNECT_MAILBOX_ID,
    });
    const tampered = tamperSignedState(authentic, field, value);

    await expect(
      controller.callback(
        req({ cookies: { oauth_state: tampered } }),
        res as unknown as Response,
        'code',
        NONCE,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(securityEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { provider: 'google', reason: 'invalid_state_cookie' },
      }),
    );
    expect(res.clearCookie).toHaveBeenCalledWith('oauth_state', { path: '/api/auth/google' });
    expect(sessions.lookupActiveById).not.toHaveBeenCalled();
    expect(oauth.exchangeCode).not.toHaveBeenCalled();
    expect(orchestrator.addMailbox).not.toHaveBeenCalled();
    expect(orchestrator.connect).not.toHaveBeenCalled();
  });

  it.each(['userId', 'workspaceId', 'sessionId', 'reconnectMailboxId'])(
    'rejects a correctly signed connect state with malformed UUID authority in %s',
    async (field) => {
      const authority: Record<string, unknown> = {
        nonce: NONCE,
        mode: 'connect',
        userId: RECONNECT_USER_ID,
        workspaceId: RECONNECT_WORKSPACE_ID,
        sessionId: CONNECT_SESSION_ID,
        reconnectMailboxId: RECONNECT_MAILBOX_ID,
      };
      authority[field] = 'not-a-uuid';
      const malformed = signedState(jwt, authority);

      await expect(
        controller.callback(
          req({ cookies: { oauth_state: malformed } }),
          res as unknown as Response,
          'code',
          NONCE,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(securityEvents.record).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { provider: 'google', reason: 'invalid_state_cookie' },
        }),
      );
      expect(res.clearCookie).toHaveBeenCalledWith('oauth_state', { path: '/api/auth/google' });
      expect(sessions.lookupActiveById).not.toHaveBeenCalled();
      expect(oauth.exchangeCode).not.toHaveBeenCalled();
      expect(orchestrator.addMailbox).not.toHaveBeenCalled();
      expect(orchestrator.connect).not.toHaveBeenCalled();
    },
  );

  it('rejects an authentically signed but expired state before session or exchange', async () => {
    const issuedAt = Date.now() - 10 * 60 * 1000;
    const expired = signedState(
      jwt,
      {
        nonce: NONCE,
        mode: 'connect',
        userId: RECONNECT_USER_ID,
        workspaceId: RECONNECT_WORKSPACE_ID,
        sessionId: CONNECT_SESSION_ID,
      },
      issuedAt + 9 * 60 * 1000,
      issuedAt,
    );

    await expect(
      controller.callback(
        req({ cookies: { oauth_state: expired } }),
        res as unknown as Response,
        'code',
        NONCE,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(res.clearCookie).toHaveBeenCalledWith('oauth_state', { path: '/api/auth/google' });
    expect(sessions.lookupActiveById).not.toHaveBeenCalled();
    expect(oauth.exchangeCode).not.toHaveBeenCalled();
    expect(orchestrator.addMailbox).not.toHaveBeenCalled();
  });

  it('rejects a signed expiry beyond the fixed ten-minute consent window', async () => {
    const overlong = signedState(
      jwt,
      { nonce: NONCE, mode: 'login' },
      Date.now() + 10 * 60 * 1000 + 30_000,
    );

    await expect(
      controller.callback(
        req({ cookies: { oauth_state: overlong } }),
        res as unknown as Response,
        'code',
        NONCE,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(res.clearCookie).toHaveBeenCalledWith('oauth_state', { path: '/api/auth/google' });
    expect(sessions.lookupActiveById).not.toHaveBeenCalled();
    expect(oauth.exchangeCode).not.toHaveBeenCalled();
    expect(orchestrator.connect).not.toHaveBeenCalled();
  });

  it.each([
    ['state', 'code', [NONCE]],
    ['code', ['code'], NONCE],
  ])('rejects a non-scalar %s query value before exchange', async (_field, code, state) => {
    await expect(
      controller.callback(req({ cookies: loginCookie() }), res as unknown as Response, code, state),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(res.clearCookie).toHaveBeenCalledWith('oauth_state', { path: '/api/auth/google' });
    expect(sessions.lookupActiveById).not.toHaveBeenCalled();
    expect(oauth.exchangeCode).not.toHaveBeenCalled();
    expect(orchestrator.connect).not.toHaveBeenCalled();
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
    expect(res.clearCookie).toHaveBeenCalledWith('oauth_state', { path: '/api/auth/google' });
    expect(oauth.exchangeCode).not.toHaveBeenCalled();
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

  it('strictly rejects an incomplete signed connect state before session or exchange', async () => {
    await expect(
      controller.callback(
        req({ cookies: connectCookie(NONCE, {}) }),
        res as unknown as Response,
        'code',
        NONCE,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(securityEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { provider: 'google', reason: 'invalid_state_cookie' },
      }),
    );
    expect(sessions.lookupActiveById).not.toHaveBeenCalled();
    expect(oauth.exchangeCode).not.toHaveBeenCalled();
  });

  it.each([
    ['revoked or missing', null],
    [
      'wrong user',
      { id: CONNECT_SESSION_ID, userId: OTHER_USER_ID, workspaceId: RECONNECT_WORKSPACE_ID },
    ],
    [
      'wrong workspace',
      { id: CONNECT_SESSION_ID, userId: RECONNECT_USER_ID, workspaceId: OTHER_WORKSPACE_ID },
    ],
  ])('rejects a %s originating session before Google exchange', async (_label, session) => {
    sessions.lookupActiveById.mockResolvedValueOnce(session);

    await expect(
      controller.callback(
        req({ cookies: connectCookie() }),
        res as unknown as Response,
        'code',
        NONCE,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(securityEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { provider: 'google', mode: 'connect', reason: 'connect_session_invalid' },
      }),
    );
    expect(res.clearCookie).toHaveBeenCalledWith('oauth_state', { path: '/api/auth/google' });
    expect(oauth.exchangeCode).not.toHaveBeenCalled();
    expect(orchestrator.addMailbox).not.toHaveBeenCalled();
  });

  it('rechecks the live session after exchange and before mailbox mutation', async () => {
    sessions.lookupActiveById
      .mockResolvedValueOnce({
        id: CONNECT_SESSION_ID,
        userId: RECONNECT_USER_ID,
        workspaceId: RECONNECT_WORKSPACE_ID,
      })
      .mockResolvedValueOnce(null);

    await expect(
      controller.callback(
        req({ cookies: connectCookie() }),
        res as unknown as Response,
        'code',
        NONCE,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(oauth.exchangeCode).toHaveBeenCalledTimes(1);
    expect(orchestrator.addMailbox).not.toHaveBeenCalled();
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
        userId: RECONNECT_USER_ID,
        workspaceId: RECONNECT_WORKSPACE_ID,
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
    expect(sessions.lookupActiveById).not.toHaveBeenCalled();
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
