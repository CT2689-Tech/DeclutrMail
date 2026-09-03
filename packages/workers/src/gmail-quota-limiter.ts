/**
 * Cross-process Gmail quota limiter (D5, D156).
 *
 * Gmail enforces 15,000 quota units per user per minute. `RateLimiter`
 * caps consumption to a deliberately-conservative 12,000 — but it holds
 * its sliding window in a `Map` inside ONE Node process, so the ceiling
 * it enforces is per-process, not per-user. Two worker instances would
 * each independently allow 12,000 units/min for the same mailbox: 24,000
 * against Google's 15,000, and the second instance is invisible to the
 * first. That is why `declutrmail-worker` is pinned to `max-instances=1`,
 * and it is the reason the pin exists rather than an unrelated choice.
 *
 * This moves the window into Redis, which every worker instance already
 * shares for BullMQ. The ceiling becomes per-mailbox across the fleet,
 * and the pin becomes a capacity decision instead of a correctness one.
 *
 * TOKEN BUCKET, not the in-process sliding window. The bucket refills
 * continuously rather than releasing the whole window at once, so a
 * limiter that just blocked recovers smoothly instead of at a cliff. It
 * is also O(1) — one hash, two fields — where summing a sliding window's
 * events in Lua would be O(events) on every single call.
 *
 * BURST CAPACITY IS SEPARATE FROM THE SUSTAINED RATE (2026-09-03,
 * post-incident). Before this, a bucket's `capacity` argument did
 * double duty: it was both the ceiling on how much could be spent
 * INSTANTLY and, divided by `windowMs`, the basis for the steady refill
 * rate — so a bucket sized for a conservative 12,000-units/60s SUSTAINED
 * average also started every mailbox with 12,000 units already sitting
 * in it, letting a fresh sync burn the whole minute's budget in a single
 * burst before the limiter ever introduced a millisecond of pacing.
 *
 * The 2026-08-26 incident (andre.darmochwal@gmail.com, workspace
 * `300563ea-…`) is consistent with exactly this: a 30k+-message mailbox
 * tripped Gmail's real quota-exceeded 403 on its first burst, and three
 * more manual retries over the next 24 minutes — each opening with the
 * SAME instant burst — never recovered; the fourth attempt failed on the
 * very first Gmail call of the job (`getProfile`). A per-minute budget
 * idle for 6–9 minutes between attempts should have fully refilled — the
 * escalating failures look like a burst-triggered penalty with a cooldown
 * measured in minutes, re-armed by each retry's own opening burst, not a
 * simple per-minute cap the account was steadily bumping against.
 *
 * The constructor now takes `burstCapacity` (the bucket's actual ceiling
 * — how much may be spent at once) SEPARATELY from
 * `sustainedUnitsPerWindow`/`windowMs` (only used to derive the refill
 * rate). Shrinking `burstCapacity` well below the sustained target
 * paces a large mailbox's fetch loop into a steady stream of calls
 * instead of a multi-thousand-call spike, without changing the total
 * long-run throughput at all — see `GMAIL_QUOTA_BURST_CAPACITY` in
 * `apps/api/src/worker.ts`.
 */

/**
 * Minimal structural slice of an ioredis client — what this limiter
 * needs. Keeps `@declutrmail/workers` from depending on ioredis
 * directly; the composition root passes its instance in. Same pattern
 * as `SnoozeLabelMapRedis`.
 */
export interface GmailQuotaRedis {
  evalsha(sha: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

/**
 * What `GmailClientService` actually needs from a limiter: block until
 * `units` may be spent. `RateLimiter` satisfies this structurally, so
 * the in-process implementation stays a drop-in fallback.
 */
export interface GmailQuotaLimiter {
  acquire(units: number): Promise<void>;
}

/** Redis key for one mailbox's Gmail quota bucket. */
export function gmailQuotaKey(mailboxAccountId: string): string {
  return `declutr:gmail:quota:${mailboxAccountId}`;
}

/**
 * Atomic variable-cost token bucket.
 *
 * KEYS[1] = bucket key
 * ARGV[1] = capacity       (units the bucket holds when full)
 * ARGV[2] = refill_per_ms  (float; capacity / windowMs)
 * ARGV[3] = now_ms         (caller-supplied clock)
 * ARGV[4] = units          (cost of THIS acquisition)
 * ARGV[5] = ttl_sec        (self-cleanup for an idle mailbox)
 *
 * Returns `{ allowed, wait_ms }`. On refusal the refilled level is still
 * written back with `last_ms = now_ms` — no tokens are consumed and none
 * are lost, so a caller that sleeps and retries sees exactly the credit
 * the elapsed time earned.
 *
 * Atomic by virtue of Redis's single-threaded EVAL: two workers cannot
 * both read a pre-state showing room for the last 5 units. That
 * indivisibility is the entire reason this is a Lua script and not a
 * GET/compute/SET from Node.
 */
export const GMAIL_QUOTA_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_per_ms = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local units = tonumber(ARGV[4])
local ttl_sec = tonumber(ARGV[5])

local bucket = redis.call('HMGET', key, 'tokens', 'last_ms')
local tokens = tonumber(bucket[1])
local last_ms = tonumber(bucket[2])

if tokens == nil or last_ms == nil then
  tokens = capacity
  last_ms = now_ms
end

local elapsed_ms = now_ms - last_ms
if elapsed_ms < 0 then
  elapsed_ms = 0
end
tokens = math.min(capacity, tokens + (elapsed_ms * refill_per_ms))

local allowed = 0
local wait_ms = 0
if tokens >= units then
  tokens = tokens - units
  allowed = 1
else
  wait_ms = math.ceil((units - tokens) / refill_per_ms)
  if wait_ms < 1 then
    wait_ms = 1
  end
end

redis.call('HMSET', key, 'tokens', tokens, 'last_ms', now_ms)
redis.call('EXPIRE', key, ttl_sec)

return { allowed, wait_ms }
`.trim();

/** Injectable clock + delay — defaults are real; tests override both. */
export interface GmailQuotaClock {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cross-process limiter for ONE mailbox.
 *
 * `fallback` is the in-process `RateLimiter` for this same mailbox. A
 * Redis error degrades to it rather than throwing: an unreachable Redis
 * must not take Gmail sync down, and a per-process ceiling is a weaker
 * guarantee than a fleet-wide one but a far better one than none. The
 * degrade is logged every time it happens — a limiter that silently
 * stopped being shared is the exact failure this class exists to end,
 * so it must never be inferable only from a Gmail 403.
 */
export class RedisGmailQuotaLimiter implements GmailQuotaLimiter {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly refillPerMs: number;
  private readonly ttlSec: number;

  constructor(
    private readonly redis: GmailQuotaRedis,
    private readonly scriptSha: string,
    private readonly mailboxAccountId: string,
    /** Bucket ceiling — the most that may be spent in one instant. */
    private readonly burstCapacity: number,
    /**
     * The sustained target this bucket paces TOWARD — together with
     * `windowMs`, only used to derive the refill rate. Independent of
     * `burstCapacity`: a mailbox can be paced to the same long-run
     * 12,000-units/60s average while never holding more than a few
     * hundred units at once.
     */
    sustainedUnitsPerWindow: number,
    windowMs: number,
    private readonly fallback: GmailQuotaLimiter,
    clock: GmailQuotaClock = {},
  ) {
    this.now = clock.now ?? Date.now;
    this.sleep = clock.sleep ?? defaultSleep;
    this.refillPerMs = sustainedUnitsPerWindow / windowMs;
    // 2x the window so an idle mailbox's key expires on its own without
    // ever discarding state a live sync still needs.
    this.ttlSec = Math.max(Math.ceil((2 * windowMs) / 1000), 1);
  }

  async acquire(units: number): Promise<void> {
    if (units > this.burstCapacity) {
      // Would sleep forever: the bucket can never hold this much. A
      // caller asking for more than the burst ceiling in one call is a
      // bug in the caller, and looping would hide it as a hang.
      throw new Error(
        `gmail quota: cannot acquire ${units} units against a burst capacity of ${this.burstCapacity}`,
      );
    }
    for (;;) {
      let result: [number, number];
      try {
        result = await this.evalScript(units);
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            kind: 'gmail.quota.redis_degraded',
            mailboxAccountId: this.mailboxAccountId,
            reason: err instanceof Error ? err.name : 'unknown',
          }),
        );
        // Per-process ceiling from here on for THIS call. The next call
        // retries Redis — a blip must not permanently unshare the limiter.
        return this.fallback.acquire(units);
      }
      const [allowed, waitMs] = result;
      if (allowed === 1) return;
      await this.sleep(waitMs);
    }
  }

  /**
   * EVALSHA first, EVAL on NOSCRIPT — the same encoding as
   * `RedisTokenBucketStore`. The full script body crosses the wire only
   * when Redis's script cache has lost the SHA (restart, failover,
   * FLUSHALL); every other call ships the digest.
   *
   * No EVALSHA retry after the EVAL fallback: EVAL already consumed the
   * units, and retrying would spend them twice.
   */
  private async evalScript(units: number): Promise<[number, number]> {
    const args: (string | number)[] = [
      gmailQuotaKey(this.mailboxAccountId),
      String(this.burstCapacity),
      String(this.refillPerMs),
      String(Math.floor(this.now())),
      String(units),
      String(this.ttlSec),
    ];
    try {
      return (await this.redis.evalsha(this.scriptSha, 1, ...args)) as [number, number];
    } catch (err) {
      if (err instanceof Error && err.message.includes('NOSCRIPT')) {
        return (await this.redis.eval(GMAIL_QUOTA_SCRIPT, 1, ...args)) as [number, number];
      }
      throw err;
    }
  }
}
