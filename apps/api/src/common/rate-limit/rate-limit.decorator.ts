import { SetMetadata } from '@nestjs/common';

import { type BucketName, type RateLimitOptions, RATE_LIMIT_METADATA } from './rate-limit.types.js';

/**
 * `@RateLimit('gmail-action')` — opt a route into rate limiting (D156).
 *
 * Two call shapes:
 *   `@RateLimit('auth')`                        — pure bucket default.
 *   `@RateLimit({ bucket, limit?, windowSec? })` — per-route override.
 *
 * Routes without the decorator are NOT throttled — the interceptor is
 * a no-op when metadata is absent. This keeps the rollout opt-in;
 * unannotated routes don't break, but they also aren't protected.
 */
export function RateLimit(
  bucketOrOpts: BucketName | RateLimitOptions,
): MethodDecorator & ClassDecorator {
  const opts: RateLimitOptions =
    typeof bucketOrOpts === 'string' ? { bucket: bucketOrOpts } : bucketOrOpts;
  return SetMetadata(RATE_LIMIT_METADATA, opts);
}
