/**
 * Atomic token-bucket script (D156).
 *
 * KEYS[1] = bucket key (e.g. "auth:user_123")
 * ARGV[1] = capacity        (integer; max tokens the bucket can hold)
 * ARGV[2] = refill_per_sec  (float;   capacity / windowSec)
 * ARGV[3] = now_ms          (integer; caller-supplied wall clock)
 * ARGV[4] = ttl_sec         (integer; expiry on the key — 2 * windowSec
 *                            so an idle bucket cleans itself up)
 *
 * The script:
 *   1. Reads current tokens + last_refill_ms (defaults: full + now).
 *   2. Refills based on elapsed time, capped at capacity.
 *   3. If tokens >= 1, deducts 1 and returns {1, floor(remaining), 0}.
 *      Else returns {0, 0, ceil(seconds until 1 token refills)}.
 *   4. Writes tokens + last_refill_ms back; sets EXPIRE for self-cleanup.
 *
 * Atomic by virtue of Redis single-threaded `EVAL` — no two callers can
 * see the same pre-state and both deduct the last token. Idempotent in
 * the sense that re-issuing the same script call IS another consume
 * attempt: there is no replay-suppression because that would invert the
 * whole point of a rate limit. The atomicity guarantee is "every call
 * sees a consistent state and either takes a token or doesn't."
 *
 * Return shape is a 3-element array so the client can branch without a
 * second round trip:
 *   { allowed: 0|1, remaining: int, retryAfterSec: int }
 */
export const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_per_sec = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local ttl_sec = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'last_refill_ms')
local tokens = tonumber(bucket[1])
local last_refill_ms = tonumber(bucket[2])

if tokens == nil or last_refill_ms == nil then
  tokens = capacity
  last_refill_ms = now_ms
end

local elapsed_ms = now_ms - last_refill_ms
if elapsed_ms < 0 then
  elapsed_ms = 0
end
local refill = (elapsed_ms / 1000.0) * refill_per_sec
tokens = math.min(capacity, tokens + refill)

local allowed = 0
local retry_after_sec = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  -- Tokens needed to reach 1 from current fractional level.
  local deficit = 1 - tokens
  -- Seconds until that deficit refills, ceil'd to whole seconds, min 1.
  retry_after_sec = math.ceil(deficit / refill_per_sec)
  if retry_after_sec < 1 then
    retry_after_sec = 1
  end
end

redis.call('HMSET', key, 'tokens', tokens, 'last_refill_ms', now_ms)
redis.call('EXPIRE', key, ttl_sec)

return { allowed, math.floor(tokens), retry_after_sec }
`.trim();
