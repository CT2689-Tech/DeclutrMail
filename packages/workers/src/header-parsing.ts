import { parseFromHeader } from './sender-key.js';

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
 *
 * Recipients are lowercased + trimmed but `+suffix` aliases are
 * **preserved** — D12's `+suffix` strip applies to the sender-key
 * dedup identity (one row per sender), not to the recipient header
 * the user actually sent to. A reply-attribution feature should still
 * be able to see that the user wrote to `bob+work@example.com`
 * specifically.
 */
export function parseRecipients(headerValue: string | null): string[] {
  if (!headerValue) {
    return [];
  }
  const out = new Set<string>();
  for (const piece of splitAddressList(headerValue)) {
    const parsed = parseFromHeader(piece);
    if (parsed) {
      out.add(parsed.email.trim().toLowerCase());
    }
  }
  return [...out];
}

/**
 * Parse `List-Unsubscribe` + `List-Unsubscribe-Post` into the THREE
 * channels they represent — HTTPS URL, mailto URL, RFC 8058 one-click
 * capability — kept SEPARATE so callers never confuse them (Codex
 * adversarial review iter 5, 2026-05-22, D9).
 *
 * The prior shape `{ url, oneClick }` collapsed channels and led
 * `deriveUnsubscribeMethod` to misclassify a plain HTTPS link (no
 * RFC 8058 post header) as `method='mailto'` while persisting an
 * `https://` URL — a method/URL mismatch the sender table cannot
 * express. Returning channels separately makes the aggregation rule's
 * intent visible at the call site.
 *
 * `List-Unsubscribe` format: `<url1>, <url2>` — HTTPS or mailto.
 * Cleartext `http:` URLs are dropped (downgrade-vulnerable per RFC
 * 8058 §3; not surfaced as a channel at all).
 *
 * Returns `{ httpsUrl: null, mailtoUrl: null, oneClick: false }` for
 * an absent / unusable header.
 */
export function parseListUnsubscribe(
  headerValue: string | null,
  postHeaderValue: string | null,
): { httpsUrl: string | null; mailtoUrl: string | null; oneClick: boolean } {
  if (!headerValue) {
    return { httpsUrl: null, mailtoUrl: null, oneClick: false };
  }
  const urls = extractBracketedUrls(headerValue);
  const httpsUrl = urls.find((u) => /^https:/i.test(u)) ?? null;
  const mailtoUrl = urls.find((u) => /^mailto:/i.test(u)) ?? null;
  // One-click requires BOTH an HTTPS URL AND the post-flag (RFC 8058).
  // A mailto-only header carrying the post-flag is NOT one-click.
  const oneClick = !!(httpsUrl && postHeaderValue && /one-click/i.test(postHeaderValue));
  return { httpsUrl, mailtoUrl, oneClick };
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
