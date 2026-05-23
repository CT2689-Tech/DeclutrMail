import { Redis } from 'ioredis';

import {
  type ConsumeResult,
  type ResolvedRateLimit,
  type TokenBucketStore,
} from './rate-limit.types.js';
import { TOKEN_BUCKET_SCRIPT } from './token-bucket.lua.js';

/**
 * Redis-backed token-bucket store (D156).
 *
 * Wraps the Lua script in a single Redis `EVAL` (note: this is the
 * Redis command name, NOT JavaScript `eval` — Lua runs server-side in
 * the Redis sandbox). ioredis caches the SHA after the first call, but
 * we use `eval` (not `evalsha`) so behavior is identical across
 * replicas / cluster failover / FLUSHALL — the trade-off vs. evalsha
 * is one round-trip with the script body instead of a load-on-NOSCRIPT
 * dance, and at rate-limiter call volumes that's not the bottleneck.
 *
 * Constructor takes an ioredis client; the module decides whether to
 * build one from REDIS_URL or skip the store entirely (fail-open).
 */
export class RedisTokenBucketStore implements TokenBucketStore {
  constructor(private readonly redis: Redis) {}

  async consume(key: string, config: ResolvedRateLimit, nowMs: number): Promise<ConsumeResult> {
    const refillPerSec = config.limit / config.windowSec;
    // 2x window so an idle key cleans itself up without losing state
    // during typical traffic — a still-active bucket gets its TTL
    // bumped on every consume.
    const ttlSec = Math.max(2 * config.windowSec, 1);

    const raw = (await this.redis.eval(
      TOKEN_BUCKET_SCRIPT,
      1,
      key,
      String(config.limit),
      String(refillPerSec),
      String(Math.floor(nowMs)),
      String(ttlSec),
    )) as [number, number, number];

    const [allowed, remaining, retryAfterSec] = raw;
    if (allowed === 1) {
      return { allowed: true, remaining };
    }
    return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
  }
}
