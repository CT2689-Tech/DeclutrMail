/**
 * Rate-limit primitives (D156).
 *
 * One closed union of bucket names — adding a new bucket means editing
 * `BUCKET_DEFAULTS` here. Routes opt in via `@RateLimit(bucket)` (see
 * `rate-limit.decorator.ts`); the interceptor reads the metadata and
 * the store enforces the limit in Redis.
 */

/**
 * Closed union of bucket names. Keep narrow on purpose: bucket choice
 * is a security decision, not a free-form string. Adding one requires
 * adding to `BUCKET_DEFAULTS` below, which forces a deliberate review
 * of the limit + window.
 */
export type BucketName = 'auth' | 'gmail-action' | 'triage-load' | 'default';

/** A bucket's enforcement parameters. */
export interface BucketConfig {
  /** Tokens allowed per window. Also the bucket capacity. */
  readonly limit: number;
  /** Window length in seconds; refill rate is `limit/windowSec` tokens/sec. */
  readonly windowSec: number;
}

/**
 * Defaults per bucket.
 *
 *   auth          5 / min   — login, OAuth callbacks (high abuse value).
 *   gmail-action  60 / min  — destructive Gmail mutations (per-user quota
 *                             tracking by `RateLimiter` in workers is
 *                             separate; this caps API surface abuse).
 *   triage-load   30 / min  — list endpoints fronting Gmail metadata.
 *   default       120 / min — everything else opted in.
 */
export const BUCKET_DEFAULTS: Readonly<Record<BucketName, BucketConfig>> = {
  auth: { limit: 5, windowSec: 60 },
  'gmail-action': { limit: 60, windowSec: 60 },
  'triage-load': { limit: 30, windowSec: 60 },
  default: { limit: 120, windowSec: 60 },
};

/**
 * Per-route override of the bucket defaults. Both fields are optional;
 * omitting either falls back to the bucket default.
 */
export interface RateLimitOptions {
  readonly bucket: BucketName;
  readonly limit?: number;
  readonly windowSec?: number;
}

/** Resolved (bucket + concrete limit/window) used by the interceptor. */
export interface ResolvedRateLimit {
  readonly bucket: BucketName;
  readonly limit: number;
  readonly windowSec: number;
}

/**
 * Outcome of a token-bucket consumption.
 *
 *   allowed=true   — token deducted, request proceeds.
 *   allowed=false  — request rejected; `retryAfterSec` is ceil(seconds
 *                    until at least one token refills), minimum 1.
 */
export type ConsumeResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSec: number };

/**
 * Token-bucket store contract. Concrete impls: Redis (prod) +
 * in-memory (tests). The interceptor depends only on this surface.
 */
export interface TokenBucketStore {
  /**
   * Attempt to consume 1 token from the bucket identified by `key`.
   * MUST be atomic — concurrent callers cannot both win the last token.
   * MUST be idempotent — re-running the same call with the same `nowMs`
   * is harmless (Redis script is replay-safe within the same time).
   *
   * @param key       Bucket key, formed as `${bucket}:${userId ?? ip}`.
   * @param config    Resolved limit + windowSec for this bucket.
   * @param nowMs     Caller-supplied clock; tests inject deterministic time.
   * @throws on infra failure — interceptor catches and fails open.
   */
  consume(key: string, config: ResolvedRateLimit, nowMs: number): Promise<ConsumeResult>;
}

/** Metadata key for the `@RateLimit` decorator. Exported for the interceptor. */
export const RATE_LIMIT_METADATA = 'declutrmail:rate-limit';
