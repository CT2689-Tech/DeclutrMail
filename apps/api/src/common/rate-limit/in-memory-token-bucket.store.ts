import {
  type ConsumeResult,
  type ResolvedRateLimit,
  type TokenBucketStore,
} from './rate-limit.types.js';

/**
 * In-memory token-bucket store — TEST ONLY.
 *
 * Mirrors the Lua script's algorithm bit-for-bit so the unit tests
 * exercise the same math (refill formula, retry-after ceil, capacity
 * cap) the production Redis store evaluates. If the Lua script changes,
 * change this in lockstep.
 *
 * Single-process only; not safe for production use.
 */
export class InMemoryTokenBucketStore implements TokenBucketStore {
  private readonly buckets = new Map<string, { tokens: number; lastRefillMs: number }>();

  async consume(key: string, config: ResolvedRateLimit, nowMs: number): Promise<ConsumeResult> {
    const refillPerSec = config.limit / config.windowSec;
    const existing = this.buckets.get(key);
    let tokens = existing?.tokens ?? config.limit;
    const lastRefillMs = existing?.lastRefillMs ?? nowMs;

    const elapsedMs = Math.max(0, nowMs - lastRefillMs);
    const refill = (elapsedMs / 1000) * refillPerSec;
    tokens = Math.min(config.limit, tokens + refill);

    if (tokens >= 1) {
      tokens -= 1;
      this.buckets.set(key, { tokens, lastRefillMs: nowMs });
      return { allowed: true, remaining: Math.floor(tokens) };
    }

    const deficit = 1 - tokens;
    const retryAfterSec = Math.max(1, Math.ceil(deficit / refillPerSec));
    this.buckets.set(key, { tokens, lastRefillMs: nowMs });
    return { allowed: false, retryAfterSec };
  }

  /** Test helper: wipe all buckets between cases. */
  reset(): void {
    this.buckets.clear();
  }
}
