import { createHash } from 'node:crypto';

import { Redis } from 'ioredis';

import {
  type ConsumeResult,
  type ResolvedRateLimit,
  type TokenBucketStore,
} from './rate-limit.types.js';
import { TOKEN_BUCKET_SCRIPT } from './token-bucket.lua.js';

/**
 * SHA1 of the Lua script — used by EVALSHA. Computed once at module
 * load: the script body is immutable, so the digest is too.
 */
const TOKEN_BUCKET_SCRIPT_SHA = createHash('sha1').update(TOKEN_BUCKET_SCRIPT).digest('hex');

/**
 * Redis-backed token-bucket store (D156).
 *
 * Hot-path encoding: EVALSHA first, EVAL on NOSCRIPT. The Lua script
 * is sent in full only when the Redis script cache doesn't recognise
 * the SHA — i.e. once per connection after a FLUSHALL / restart /
 * failover. Every other call ships ~40 bytes of SHA + args instead of
 * the ~1KB script body. These are Redis server-side commands (the Lua
 * runs in Redis's sandbox); they are not the JavaScript `eval`.
 *
 * Float-precision note: the script stores `tokens` and `last_refill_ms`
 * via HMSET. Redis serialises Lua numbers to strings and Lua coerces
 * them back via `tonumber` on the next call — round-tripping is
 * lossless within IEEE-754, and bucket math doesn't need
 * sub-microsecond precision. No drift.
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

    const args: [string, string, string, string] = [
      String(config.limit),
      String(refillPerSec),
      String(Math.floor(nowMs)),
      String(ttlSec),
    ];

    const raw = (await this.runScript(key, args)) as [number, number, number];

    const [allowed, remaining, retryAfterSec] = raw;
    if (allowed === 1) {
      return { allowed: true, remaining };
    }
    return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
  }

  /**
   * EVALSHA → on NOSCRIPT, fall back to EVAL (which loads the script
   * into Redis's cache as a side effect). Subsequent calls go straight
   * to EVALSHA again.
   *
   * We deliberately do NOT retry EVALSHA after the EVAL fallback: EVAL
   * already returned the result, so a retry would double-consume. The
   * NEXT call will use EVALSHA and succeed against the now-cached SHA.
   */
  private async runScript(key: string, args: [string, string, string, string]): Promise<unknown> {
    const r = this.redis;
    try {
      return await r.evalsha(TOKEN_BUCKET_SCRIPT_SHA, 1, key, ...args);
    } catch (err) {
      if (isNoScriptError(err)) {
        // First call on this connection (or after FLUSHALL / restart).
        // EVAL both executes and caches the script for future EVALSHAs.
        return await r.eval(TOKEN_BUCKET_SCRIPT, 1, key, ...args);
      }
      throw err;
    }
  }
}

/**
 * ioredis reports a missing script as a ReplyError whose `message`
 * starts with `NOSCRIPT`. Match on the message to avoid coupling to
 * ioredis's private error class.
 */
function isNoScriptError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('NOSCRIPT');
}
