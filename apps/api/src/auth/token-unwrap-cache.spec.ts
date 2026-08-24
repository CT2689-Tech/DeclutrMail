import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { TokenUnwrapCache } from './token-unwrap-cache.js';

const CT = Buffer.from('ciphertext-v1');
const DEK = Buffer.from('wrapped-dek-v1');
const TOKEN = '1//0gRefreshTokenPlaintextThatMustNeverLeak';
const MB = 'mailbox-1';

/** A cache whose clock the test drives; no test may depend on wall time. */
function cacheAt(startMs: number, opts: { ttlMs?: number; maxEntries?: number } = {}) {
  let t = startMs;
  const cache = new TokenUnwrapCache({ ...opts, now: () => t });
  return { cache, advance: (ms: number) => (t += ms) };
}

describe('TokenUnwrapCache', () => {
  it('returns the plaintext for the exact same ciphertext and wrapped DEK', () => {
    const { cache } = cacheAt(1000);
    cache.set(MB, CT, DEK, TOKEN);
    expect(cache.get(MB, CT, DEK)).toBe(TOKEN);
  });

  it('misses when the ciphertext changed — a token rotation', () => {
    // The reason this is keyed on ciphertext at all. A re-consented or
    // rotated mailbox writes new bytes; reusing the old plaintext would
    // authenticate as a credential the user has already replaced.
    const { cache } = cacheAt(1000);
    cache.set(MB, CT, DEK, TOKEN);
    expect(cache.get(MB, Buffer.from('ciphertext-v2'), DEK)).toBeNull();
  });

  it('misses when the wrapped DEK changed — a KMS key rotation', () => {
    // The ciphertext can stay byte-identical across a re-key. Comparing
    // only the ciphertext would let a plaintext unwrapped under a retired
    // key version keep being served, making the rotation ineffective for
    // as long as the TTL.
    const { cache } = cacheAt(1000);
    cache.set(MB, CT, DEK, TOKEN);
    expect(cache.get(MB, CT, Buffer.from('wrapped-dek-v2'))).toBeNull();
  });

  it('misses once the entry is older than the TTL', () => {
    const { cache, advance } = cacheAt(1000, { ttlMs: 60_000 });
    cache.set(MB, CT, DEK, TOKEN);
    advance(59_999);
    expect(cache.get(MB, CT, DEK)).toBe(TOKEN);
    advance(1);
    expect(cache.get(MB, CT, DEK)).toBeNull();
  });

  it('never serves one mailbox the token of another', () => {
    const { cache } = cacheAt(1000);
    cache.set(MB, CT, DEK, TOKEN);
    expect(cache.get('mailbox-2', CT, DEK)).toBeNull();
  });

  it('drops the entry on a miss rather than leaving stale plaintext resident', () => {
    // Once the stored bytes are known not to match the live row, the
    // plaintext is dead material. Holding it until the TTL would extend
    // a retired credential's memory residency for no benefit at all.
    const { cache } = cacheAt(1000);
    cache.set(MB, CT, DEK, TOKEN);
    cache.get(MB, Buffer.from('ciphertext-v2'), DEK);
    expect(cache.size).toBe(0);
  });

  it('bounds how many plaintext tokens are resident at once', () => {
    const { cache } = cacheAt(1000, { maxEntries: 3 });
    for (let i = 0; i < 10; i += 1) cache.set(`mb-${i}`, CT, DEK, TOKEN);
    expect(cache.size).toBe(3);
    // Oldest evicted, newest kept.
    expect(cache.get('mb-0', CT, DEK)).toBeNull();
    expect(cache.get('mb-9', CT, DEK)).toBe(TOKEN);
  });

  it('is not fooled by a caller mutating the buffer it handed in', () => {
    // Row values and pooled buffers get reused. If the cache stored the
    // caller's Buffer by reference, a later mutation would make the key
    // compare equal to material the row no longer holds.
    const mutable = Buffer.from('ciphertext-v1');
    const { cache } = cacheAt(1000);
    cache.set(MB, mutable, DEK, TOKEN);
    mutable.write('X');
    expect(cache.get(MB, mutable, DEK)).toBeNull();
  });

  it('keeps the plaintext out of anything that serializes the cache', () => {
    // A logger, a Sentry breadcrumb, or a bare console.log reaching for
    // this object must not be able to put refresh tokens in a log sink.
    const { cache } = cacheAt(1000);
    cache.set(MB, CT, DEK, TOKEN);
    expect(JSON.stringify({ cache })).not.toContain(TOKEN);
    expect(inspect(cache, { depth: 10 })).not.toContain(TOKEN);
    expect(String(cache)).not.toContain(TOKEN);
  });

  it('would notice if the leak guards were removed', () => {
    // Negative control for the test above: prove the assertion can fail.
    // Without this, deleting toJSON and the inspect hook leaves a green
    // suite that claims a privacy property it no longer has.
    const leaky = { plaintext: TOKEN };
    expect(JSON.stringify({ leaky })).toContain(TOKEN);
    expect(inspect(leaky, { depth: 10 })).toContain(TOKEN);
  });
});
