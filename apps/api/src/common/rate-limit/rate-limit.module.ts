import { Global, Logger, Module, type Provider } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Redis } from 'ioredis';

import { RateLimitInterceptor, TOKEN_BUCKET_STORE } from './rate-limit.interceptor.js';
import { RedisTokenBucketStore } from './redis-token-bucket.store.js';
import { type TokenBucketStore } from './rate-limit.types.js';

const bootLogger = new Logger('RateLimitModule');

/**
 * Build the token-bucket store from environment.
 *
 *   REDIS_URL present  → RedisTokenBucketStore (production path).
 *   REDIS_URL missing  → null; the interceptor fails open. This is the
 *                        expected dev path before Redis is provisioned;
 *                        we log a single warning at boot so it's visible
 *                        but don't crash the API (D156 fail-open rule).
 *
 * Production startup guard: in `NODE_ENV=production`, an unset
 * REDIS_URL is a security gap — per-process in-memory limiting on
 * Cloud Run means attackers landing on different instances each get
 * their own bucket, effectively bypassing the limit. We refuse to boot
 * in that posture. The escape hatch is `RATE_LIMIT_ENABLED=false`
 * (explicit acknowledgment that the limiter is intentionally off);
 * dev/test are unaffected.
 *
 * Connection reuse: we build a dedicated ioredis client here rather
 * than sharing the BullMQ connection. BullMQ requires
 * `maxRetriesPerRequest: null` which is wrong for short-deadline
 * limiter calls — a Redis blip should fail fast (and trip fail-open),
 * not retry forever.
 */
function buildStore(): TokenBucketStore | null {
  const url = process.env.REDIS_URL;
  const isProd = process.env.NODE_ENV === 'production';
  // RATE_LIMIT_ENABLED defaults to 'true' (any value other than the literal
  // string 'false' keeps the limiter on). Explicit opt-out only.
  const rateLimitEnabled = process.env.RATE_LIMIT_ENABLED !== 'false';

  if (!url) {
    if (isProd && rateLimitEnabled) {
      throw new Error(
        'REDIS_URL is required in production when rate limiting is enabled. ' +
          'In-memory fail-open is per-process and does not share state across ' +
          'Cloud Run instances — attackers can bypass limits by landing on ' +
          'different instances. Set REDIS_URL, or explicitly disable the ' +
          'limiter with RATE_LIMIT_ENABLED=false to acknowledge the gap.',
      );
    }
    bootLogger.warn(
      'REDIS_URL not set — rate limiter disabled (fail-open). Set REDIS_URL to enforce limits.',
    );
    return null;
  }
  const client = new Redis(url, {
    // Fail fast: limiter calls are on the hot request path; we'd rather
    // return null (→ fail-open allow) than queue retries.
    maxRetriesPerRequest: 1,
    // Don't queue commands while disconnected — they'd block the request.
    enableOfflineQueue: false,
  });
  client.on('error', (err) => {
    // ioredis fires 'error' for every reconnect attempt; throttle the
    // noise by only logging the message, not the stack.
    bootLogger.error(`Redis rate-limit client error: ${err.message}`);
  });
  return new RedisTokenBucketStore(client);
}

const STORE_PROVIDER: Provider = {
  provide: TOKEN_BUCKET_STORE,
  useFactory: () => buildStore(),
};

/**
 * RateLimitModule (D156) — global so the interceptor + store reach
 * every controller without per-feature imports. Marked `@Global` so the
 * `TOKEN_BUCKET_STORE` token is visible to anything that wants direct
 * access (currently nothing — only the interceptor uses it).
 *
 * The interceptor is registered as APP_INTERCEPTOR so it sees every
 * request; it's a no-op for routes without `@RateLimit(...)` metadata.
 */
@Global()
@Module({
  providers: [
    STORE_PROVIDER,
    {
      provide: APP_INTERCEPTOR,
      useClass: RateLimitInterceptor,
    },
  ],
  exports: [TOKEN_BUCKET_STORE],
})
export class RateLimitModule {}
