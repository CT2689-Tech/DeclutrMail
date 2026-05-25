import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import {
  RATE_LIMIT_METADATA,
  type RateLimitOptions,
} from '../common/rate-limit/rate-limit.types.js';
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
