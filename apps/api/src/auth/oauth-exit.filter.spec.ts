import {
  BadRequestException,
  type CanActivate,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { JwtService } from './jwt.service.js';
import { LoginStartExitFilter, OAuthCallbackExitFilter } from './oauth-exit.filter.js';

const WEB = 'https://app.example.test';
const BILLING = '/billing?plan=pro&cycle=annual';
const BILLING_QUERY = 'returnTo=%2Fbilling%3Fplan%3Dpro%26cycle%3Dannual';

function makeJwtService(): JwtService {
  process.env.JWT_ACCESS_SECRET = 'oauth-exit-test-access-secret-0000000000001';
  process.env.JWT_REFRESH_SECRET = 'oauth-exit-test-refresh-secret-000000000002';
  return new JwtService();
}

/** A browser request as the base filter and the exit filters read it. */
function fakeRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    route: { path: '/api/auth/google/callback' },
    cookies: {},
    query: {},
    ...overrides,
  } as unknown as Request;
}

function run(
  filter: LoginStartExitFilter | OAuthCallbackExitFilter,
  exception: unknown,
  req: Request,
  headersSent = false,
) {
  const res = {
    req,
    headersSent,
    redirect: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
  const host = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
  filter.catch(exception, host as unknown as Parameters<LoginStartExitFilter['catch']>[1]);
  return res;
}

/**
 * The Google OAuth routes are full-page browser navigations (D108). A
 * failure on one must land on a page that says what happened, never on
 * API JSON — while the structured log and 5xx Sentry capture every other
 * route gets still happen.
 */
describe('OAuth exit filters', () => {
  const originalWebUrl = process.env.WEB_URL;
  let jwt: JwtService;
  let logError: MockInstance;
  let consoleError: MockInstance;

  beforeEach(() => {
    process.env.WEB_URL = `${WEB}/`;
    jwt = makeJwtService();
    logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logError.mockRestore();
    consoleError.mockRestore();
    if (originalWebUrl === undefined) delete process.env.WEB_URL;
    else process.env.WEB_URL = originalWebUrl;
  });

  function stateCookie(state: Record<string, unknown>): Record<string, string> {
    return { oauth_state: jwt.sealOAuthState(JSON.stringify(state)) };
  }

  describe('LoginStartExitFilter', () => {
    it.each([
      [new HttpException('slow down', HttpStatus.TOO_MANY_REQUESTS), 'rate_limited'],
      [new BadRequestException('private request detail'), 'failed'],
      [new InternalServerErrorException('private config detail'), 'failed'],
      [new Error('private runtime detail'), 'failed'],
    ] as const)('sends a failed start to sign-in as %s', (exception, result) => {
      const res = run(
        new LoginStartExitFilter(),
        exception,
        fakeRequest({ route: { path: '/api/auth/google/start' }, query: { returnTo: BILLING } }),
      );

      expect(res.redirect).toHaveBeenCalledWith(
        302,
        `${WEB}/sign-in?auth_result=${result}&${BILLING_QUERY}`,
      );
      expect(res.json).not.toHaveBeenCalled();
      expect(JSON.stringify(res.redirect.mock.calls)).not.toContain('private');
    });

    it('drops a forged returnTo instead of leaving the site', () => {
      const res = run(
        new LoginStartExitFilter(),
        new BadRequestException(),
        fakeRequest({ query: { returnTo: 'https://evil.example/billing?plan=pro' } }),
      );

      expect(res.redirect).toHaveBeenCalledWith(302, `${WEB}/sign-in?auth_result=failed`);
    });
  });

  describe('OAuthCallbackExitFilter', () => {
    it('returns a failed sign-in to /sign-in with the billing choice from the signed state', () => {
      const res = run(
        new OAuthCallbackExitFilter(jwt),
        new Error('invalid_grant from Google'),
        fakeRequest({ cookies: stateCookie({ nonce: 'n', mode: 'login', returnTo: BILLING }) }),
      );

      expect(res.redirect).toHaveBeenCalledWith(
        302,
        `${WEB}/sign-in?auth_result=failed&${BILLING_QUERY}`,
      );
    });

    it.each([
      [new UnauthorizedException(), 'session_retry'],
      [new HttpException('slow down', HttpStatus.TOO_MANY_REQUESTS), 'rate_limited'],
      [new Error('private runtime detail'), 'failed'],
    ] as const)('returns a failed mailbox connection to Settings as %s', (exception, result) => {
      const res = run(
        new OAuthCallbackExitFilter(jwt),
        exception,
        fakeRequest({ cookies: stateCookie({ nonce: 'n', mode: 'connect' }) }),
      );

      expect(res.redirect).toHaveBeenCalledWith(
        302,
        `${WEB}/settings?connect_start_result=${result}#mailboxes`,
      );
    });

    it.each([
      ['no state cookie', {}],
      ['an unsigned state cookie', { oauth_state: 'v1.eyJtb2RlIjoiY29ubmVjdCJ9.forged' }],
    ])('lands on sign-in when the flow is unknown: %s', (_label, cookies) => {
      const res = run(
        new OAuthCallbackExitFilter(jwt),
        new BadRequestException('Missing OAuth state cookie.'),
        fakeRequest({ cookies }),
      );

      expect(res.redirect).toHaveBeenCalledWith(302, `${WEB}/sign-in?auth_result=failed`);
    });
  });

  it('still logs and reports a 5xx before redirecting', () => {
    run(new OAuthCallbackExitFilter(jwt), new Error('token endpoint down'), fakeRequest());

    // A total sign-in outage must stay visible even though the person
    // sees a page: the base filter's structured 5xx line still runs.
    expect(logError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('"kind":"exception.5xx"'));
  });

  it('does not answer twice when the handler already responded', () => {
    const res = run(
      new OAuthCallbackExitFilter(jwt),
      new Error('late failure'),
      fakeRequest(),
      true,
    );

    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  describe('over HTTP', () => {
    @Injectable()
    class RateLimitedBeforeHandler implements CanActivate {
      canActivate(): boolean {
        throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    @Controller('_oauth-exit-filter-test')
    class BrowserOAuthRoutes {
      @Get('start')
      @UseGuards(RateLimitedBeforeHandler)
      @UseFilters(LoginStartExitFilter)
      start(): void {}

      @Get('callback')
      @UseGuards(RateLimitedBeforeHandler)
      @UseFilters(OAuthCallbackExitFilter)
      callback(): void {}
    }

    async function withApp(check: (baseUrl: string) => Promise<void>): Promise<void> {
      const moduleRef = await Test.createTestingModule({
        controllers: [BrowserOAuthRoutes],
        providers: [RateLimitedBeforeHandler, { provide: JwtService, useValue: jwt }],
      }).compile();
      const app = moduleRef.createNestApplication();
      app.use(cookieParser());
      try {
        await app.listen(0, '127.0.0.1');
        await check(await app.getUrl());
      } finally {
        await app.close();
      }
    }

    it('turns a rejection before the start handler runs into the sign-in page', async () => {
      await withApp(async (base) => {
        const response = await fetch(
          `${base}/_oauth-exit-filter-test/start?returnTo=${encodeURIComponent(BILLING)}`,
          { redirect: 'manual' },
        );

        expect(response.status).toBe(HttpStatus.FOUND);
        expect(response.headers.get('location')).toBe(
          `${WEB}/sign-in?auth_result=rate_limited&${BILLING_QUERY}`,
        );
      });
    });

    it('routes a callback rejection by the flow in the signed state cookie', async () => {
      await withApp(async (base) => {
        const cookie = stateCookie({ nonce: 'n', mode: 'connect' }).oauth_state;
        const response = await fetch(`${base}/_oauth-exit-filter-test/callback`, {
          redirect: 'manual',
          headers: { cookie: `oauth_state=${cookie}` },
        });

        expect(response.status).toBe(HttpStatus.FOUND);
        expect(response.headers.get('location')).toBe(
          `${WEB}/settings?connect_start_result=rate_limited#mailboxes`,
        );
      });
    });
  });
});
