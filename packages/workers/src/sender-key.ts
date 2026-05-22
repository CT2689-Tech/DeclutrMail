import { createHash } from 'node:crypto';

/**
 * Sender-key derivation (D12 / ADR-0011).
 *
 *   sender_key = sha256("v1|" + normalized_email), hex
 *
 * `normalized_email` is the address lowercased + trimmed. The `"v1|"`
 * prefix versions the scheme so a future normalization change can ship a
 * `"v2|"` key without colliding with stored `"v1|"` keys.
 */

/** Lowercase + trim — the D12 normalization. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** sha256("v1|" + normalized_email), hex (D12). */
export function deriveSenderKey(email: string): string {
  return createHash('sha256')
    .update(`v1|${normalizeEmail(email)}`)
    .digest('hex');
}

/** Domain part of an email — text after the last `@`, lowercased. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1
    ? ''
    : email
        .slice(at + 1)
        .trim()
        .toLowerCase();
}

/** A parsed `From` header — a display name (possibly empty) + an address. */
export interface ParsedSender {
  displayName: string;
  email: string;
}

/**
 * Parse a `From` header value into a display name + address.
 *
 * Handles `"Jane Doe" <jane@x.com>`, `Jane Doe <jane@x.com>`, and a bare
 * `jane@x.com`. Returns `null` when no address can be extracted — the
 * caller skips such messages (they cannot be keyed).
 *
 * The display name is kept as Gmail returns it; RFC 2047 encoded-word
 * decoding is a later cosmetic refinement, not a PR-C concern.
 */
export function parseFromHeader(value: string | null): ParsedSender | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();

  const angle = trimmed.match(/<([^<>]+)>/);
  if (angle?.[1]) {
    const email = angle[1].trim();
    if (!email.includes('@')) {
      return null;
    }
    const displayName = trimmed
      .slice(0, trimmed.indexOf('<'))
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .trim();
    return { displayName, email };
  }

  // No angle brackets — treat the whole value as a bare address.
  if (trimmed.includes('@')) {
    return { displayName: '', email: trimmed };
  }
  return null;
}
