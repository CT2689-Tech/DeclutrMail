import { normalizeEmail, parseFromHeader } from './sender-key.js';

/**
 * Parsing for the D7-allowlist-amended headers added in ADR-0004 —
 * `To`/`Cc` (recipients) and `List-Unsubscribe`/`List-Unsubscribe-Post`
 * (D9, RFC 8058).
 */

/**
 * Parse a `To` / `Cc` header value into a deduped list of normalized
 * recipient emails. Handles comma-separated lists with mixed forms:
 *   `"Alice" <a@x.com>, b@x.com, "Bob" <b@x.com>`
 * Returns `[]` for a null / unusable header.
 */
export function parseRecipients(headerValue: string | null): string[] {
  if (!headerValue) {
    return [];
  }
  const out = new Set<string>();
  for (const piece of splitAddressList(headerValue)) {
    const parsed = parseFromHeader(piece);
    if (parsed) {
      out.add(normalizeEmail(parsed.email));
    }
  }
  return [...out];
}

/**
 * Parse `List-Unsubscribe` + `List-Unsubscribe-Post` into the URL we
 * will act on plus a one-click capability flag (RFC 8058, D9).
 *
 * `List-Unsubscribe` format: `<url1>, <url2>` where each URL is either
 * `https://...` or `mailto:...`. Multiple URLs are allowed; we prefer
 * https for one-click. `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 * (case-insensitive on `One-Click`) signals one-click capability.
 *
 * Returns `{ url: null, oneClick: false }` when no usable header is present.
 */
export function parseListUnsubscribe(
  headerValue: string | null,
  postHeaderValue: string | null,
): { url: string | null; oneClick: boolean } {
  if (!headerValue) {
    return { url: null, oneClick: false };
  }
  const urls = extractBracketedUrls(headerValue);
  // One-click MUST be HTTPS (RFC 8058 §3 — security; cleartext `http:`
  // POSTs are downgrade-vulnerable and not eligible for the automated
  // unsubscribe trust boundary). `http:` URLs are simply not surfaced
  // as one-click candidates; if the header also carries a mailto we
  // fall back to that, otherwise the sender is treated as non-
  // unsubscribable by automation. Codex adversarial review iter 4.
  const https = urls.find((u) => /^https:/i.test(u));
  const mailto = urls.find((u) => /^mailto:/i.test(u));
  const url = https ?? mailto ?? null;
  // One-click requires both the https URL AND the post-flag (RFC 8058).
  const oneClick = !!(https && postHeaderValue && /one-click/i.test(postHeaderValue));
  return { url, oneClick };
}

/**
 * Split an RFC 5322 address-list on commas that are OUTSIDE quoted
 * strings or angle brackets. Naïve but sufficient for the From/To/Cc
 * shapes Gmail returns in metadata headers.
 */
function splitAddressList(value: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inQuote = false;
  let inAngle = 0;
  for (const ch of value) {
    if (ch === '"') {
      inQuote = !inQuote;
      buf += ch;
    } else if (ch === '<') {
      inAngle += 1;
      buf += ch;
    } else if (ch === '>') {
      inAngle = Math.max(0, inAngle - 1);
      buf += ch;
    } else if (ch === ',' && !inQuote && inAngle === 0) {
      if (buf.trim()) {
        out.push(buf.trim());
      }
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) {
    out.push(buf.trim());
  }
  return out;
}

/** Extract every `<...>` URL from a `List-Unsubscribe` header value. */
function extractBracketedUrls(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(/<([^<>]+)>/g)) {
    const url = m[1]?.trim();
    if (url) {
      out.push(url);
    }
  }
  return out;
}
