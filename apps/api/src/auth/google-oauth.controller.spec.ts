import type { Request, Response } from 'express';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RATE_LIMIT_METADATA,
  type RateLimitOptions,
} from '../common/rate-limit/rate-limit.types.js';
import type { AuthSignupOrchestrator } from './auth-signup.orchestrator.js';
import type { GoogleOAuthService } from './google-oauth.service.js';
import { GoogleOAuthController } from './google-oauth.controller.js';

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
  let controller: GoogleOAuthController;
  let res: { clearCookie: ReturnType<typeof vi.fn>; redirect: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    orchestrator = { addMailbox: vi.fn().mockResolvedValue({ mailboxId: 'mailbox-new' }) };
    oauth = {
      exchangeCode: vi.fn().mockResolvedValue({ email: 'second@example.com', refreshToken: 'rt' }),
    };
    res = { clearCookie: vi.fn(), redirect: vi.fn() };
    controller = new GoogleOAuthController(
      oauth as unknown as GoogleOAuthService,
      orchestrator as unknown as AuthSignupOrchestrator,
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
