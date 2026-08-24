import { inspect } from 'node:util';

/**
 * Ciphertext-keyed cache for the KMS unwrap on the Gmail token path.
 *
 * MEASURED, 24 Aug 2026: 5,000 KMS decrypts over 5.13 days — 975/day,
 * mean 116 ms, p95 172 ms, worst 1,116 ms. Every one of them in the
 * worker, and every one inside the per-mailbox advisory lock that a
 * user's Delete queues behind. 30% land within 30 seconds of a previous
 * decrypt for the same mailbox; a 10-minute reuse window removes 68%.
 *
 * WHAT THIS DELIBERATELY DOES NOT CACHE
 *
 * The obvious design caches the built `GmailClientService` per mailbox.
 * It was rejected, and the reason is a safety property the code states
 * out loud. `MailboxAccountsService.disconnect` nullifies
 * `encrypted_refresh_token` and `dek_encrypted` precisely so a stale
 * refresh token cannot be used — "the local nullify still blocks the app
 * from using the (possibly stale) refresh". A cached client holds the
 * plaintext in memory and never re-reads that row, so it keeps acting on
 * a mailbox the user disconnected. Worse, the API performs the disconnect
 * and the worker holds the cache: they are separate Cloud Run services,
 * so no in-process invalidation can reach across. `MAILBOX_DELETED`,
 * documented in `topics.ts` as the eviction hook for exactly this, has
 * zero consumers.
 *
 * So the row read stays on every call — it costs ~1.4 ms of server time —
 * and only the KMS unwrap is reused, keyed on the ciphertext that read
 * returns. The safety property then holds BY CONSTRUCTION rather than by
 * an eviction path that has to fire correctly:
 *
 *   disconnect  → columns are NULL → the caller throws before ever
 *                 reaching this cache.
 *   rotation    → ciphertext differs → miss → fresh unwrap.
 *   re-key      → wrapped DEK differs → miss → fresh unwrap.
 *
 * RESIDUAL RISK, stated plainly: a decrypted refresh token lives in
 * worker memory for up to `ttlMs` instead of for the length of one job.
 * The process already holds it during every job and jobs run every ~5
 * minutes, so the delta is small — but it is not zero, which is why the
 * TTL and the entry count are both bounded and why nothing here is ever
 * logged or serialized.
 */

/** One cached unwrap. `plaintext` is a refresh token — never log it. */
interface Entry {
  ciphertext: Buffer;
  wrappedDek: Buffer;
  plaintext: string;
  storedAtMs: number;
}

/** Default reuse window — 10 minutes; removes 68% of measured decrypts. */
export const DEFAULT_TOKEN_UNWRAP_TTL_MS = 10 * 60 * 1000;

/**
 * Default entry ceiling. One entry per mailbox actively syncing in this
 * process; the bound exists so a pathological workload cannot grow the
 * set of in-memory plaintext tokens without limit.
 */
export const DEFAULT_TOKEN_UNWRAP_MAX_ENTRIES = 256;

export interface TokenUnwrapCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export class TokenUnwrapCache {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: TokenUnwrapCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TOKEN_UNWRAP_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_TOKEN_UNWRAP_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  /**
   * The plaintext for this exact ciphertext + wrapped DEK, or `null`.
   *
   * Both halves are compared. The ciphertext alone would be enough to
   * catch a token rotation, but a re-key rewrites the wrapped DEK while
   * the ciphertext can stay byte-identical, and returning a plaintext
   * unwrapped under a retired key version would make a KMS key rotation
   * silently ineffective for as long as the TTL.
   */
  get(mailboxAccountId: string, ciphertext: Buffer, wrappedDek: Buffer): string | null {
    const hit = this.entries.get(mailboxAccountId);
    if (!hit) return null;
    if (this.now() - hit.storedAtMs >= this.ttlMs) {
      this.entries.delete(mailboxAccountId);
      return null;
    }
    if (!hit.ciphertext.equals(ciphertext) || !hit.wrappedDek.equals(wrappedDek)) {
      this.entries.delete(mailboxAccountId);
      return null;
    }
    return hit.plaintext;
  }

  set(mailboxAccountId: string, ciphertext: Buffer, wrappedDek: Buffer, plaintext: string): void {
    // Re-insert so this key becomes the most recent in Map order, which
    // is insertion order — that is what makes the eviction below LRU-ish
    // rather than "whichever mailbox happened to sync first, forever".
    this.entries.delete(mailboxAccountId);
    this.entries.set(mailboxAccountId, {
      // Copy: the caller's Buffer is a row value it may reuse or a view
      // into a larger pool buffer, and a mutated key would compare equal
      // to material it no longer holds.
      ciphertext: Buffer.from(ciphertext),
      wrappedDek: Buffer.from(wrappedDek),
      plaintext,
      storedAtMs: this.now(),
    });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /** Drop one mailbox's entry. */
  delete(mailboxAccountId: string): void {
    this.entries.delete(mailboxAccountId);
  }

  /** Observability only — a count, never contents. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Refuse to serialize.
   *
   * `console.log({ cache })`, a Sentry breadcrumb, or any structured
   * logger reaching for this object would otherwise put plaintext refresh
   * tokens into a log sink. Overriding both hooks makes that impossible
   * by accident rather than by remembering.
   */
  toJSON(): string {
    return '[TokenUnwrapCache]';
  }

  [inspect.custom](): string {
    return '[TokenUnwrapCache]';
  }
}
