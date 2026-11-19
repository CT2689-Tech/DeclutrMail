import { createHash } from 'node:crypto';

/**
 * SHA-256 hex of an opaque OAuth secret (token, authorization code,
 * interaction id). The stored form of every such value — the raw value
 * is never written (ADR-0048 rule 4), matching `hashRefreshToken` for
 * session cookies.
 *
 * Unsalted on purpose: these are 126–256-bit random values, not
 * passwords, so there is nothing to brute-force and the hash must be a
 * deterministic lookup key.
 */
export function hashOAuthSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
