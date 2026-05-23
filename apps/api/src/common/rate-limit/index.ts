/**
 * Public surface of the rate-limit module (D156). Callers should import
 * `@RateLimit(...)` from here; the rest is internal to the module.
 */
export { RateLimit } from './rate-limit.decorator.js';
export { RateLimitModule } from './rate-limit.module.js';
export type { BucketName, RateLimitOptions } from './rate-limit.types.js';
