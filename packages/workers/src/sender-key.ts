import { createHash } from 'node:crypto';

/**
 * Sender-key derivation (D12 / ADR-0011).
 *
 *   sender_key = sha256("v1|" + normalized_email), hex
 *
 * `normalized_email` is the address lowercased + trimmed, with the
 * `+suffix` alias stripped from the local part (D12 example:
 * `foo+notion@gmail.com` → `foo@gmail.com`). The `"v1|"` prefix versions
 * the scheme so a future normalization change can ship a `"v2|"` key
 * without colliding with stored `"v1|"` keys.
 *
 * Dotless-local-part normalization (the Gmail-specific "jane.doe ==
 * janedoe" rule) is intentionally NOT applied — D12 only specifies the
 * `+suffix` strip, and dotless folding would collide non-Gmail addresses
 * that legitimately differ by dot.
 */

/**
 * Lowercase + trim + strip `+suffix` aliases from the local part (D12).
 *
 * The strip only happens when the `+` lives in the local part (before
 * the last `@`) and is not at position 0 (no local part to alias).
 * Inputs without an `@` or with the `+` only in the domain are
 * lowercased/trimmed unchanged.
 */
export function normalizeEmail(raw: string): string {
  const lowered = raw.trim().toLowerCase();
  const at = lowered.lastIndexOf('@');
  if (at <= 0) {
    // No local part (e.g. `@x.com`) or no `@` at all — return as-is.
    return lowered;
  }
  const local = lowered.slice(0, at);
  const domain = lowered.slice(at);
  const plus = local.indexOf('+');
  if (plus <= 0) {
    // No `+`, or `+` is the entire local part — leave unchanged so the
    // string round-trips to itself and we don't synthesise an empty local.
    return lowered;
  }
  return `${local.slice(0, plus)}${domain}`;
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
