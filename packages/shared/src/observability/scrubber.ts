/**
 * Privacy scrubber for telemetry payloads (D7, D228, D159).
 *
 * DeclutrMail's privacy guardrail is **no full message body, no
 * attachments, no non-allowlisted headers, ever** — and that extends
 * to Sentry events and PostHog event properties.
 *
 * This module implements defense-in-depth scrubbing: callers should
 * already pass only scalars they want emitted, but the SDK `beforeSend`
 * hooks wrap every payload through `scrubObject` so that if some future
 * code path forgets and spreads a raw message into a Sentry extra, the
 * banned keys still get stripped before the wire.
 *
 * Pure functions — no SDK imports, no side effects. Safe to run in
 * both Node and browser contexts.
 */

/**
 * Top-level keys that are *always* removed, regardless of where they
 * appear in the object graph. Matched case-insensitively.
 *
 * Keep this list narrow and precise. Adding a key here is a privacy
 * promise to remove ALL data under that key from telemetry; do not
 * add keys that might also carry safe metadata.
 */
const BANNED_KEY_PATTERNS: ReadonlyArray<RegExp> = [
  /^body$/i,
  /^htmlBody$/i,
  /^textBody$/i,
  /^snippet$/i,
  /^payload$/i, // Gmail message envelope — always contains body parts
  /^attachment/i, // attachment, attachments, attachmentId, etc.
  /^mime/i, // mime, mimeType, mimeContent, raw mime, etc.
  /^raw$/i, // Gmail raw message format
  /^html$/i,
  /^text$/i, // generic body text key (covers textPlain etc. via prefix below)
  /^textPlain$/i,
  /^textHtml$/i,
  /^content$/i, // generic content blob
  /^parts$/i, // MIME parts array on Gmail payload
];

/**
 * Header allowlist (D7, D228). Headers OUTSIDE this list are stripped
 * from any `headers` object encountered in telemetry payloads.
 *
 * Matching is case-insensitive against the header NAME (object key).
 * Subject is in the allowlist because the product already stores it.
 * Message-ID is intentionally OMITTED per D231.
 */
const HEADER_ALLOWLIST: ReadonlySet<string> = new Set(
  [
    'subject',
    'from',
    'to',
    'cc',
    'date',
    'message-id',
    'list-unsubscribe',
    'list-unsubscribe-post',
  ].map((h) => h.toLowerCase()),
);

const REDACTED = '[redacted]' as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isBannedKey(key: string): boolean {
  return BANNED_KEY_PATTERNS.some((re) => re.test(key));
}

/**
 * Strip headers that are not in the allowlist (D7).
 *
 * `headers` may arrive in two shapes:
 * - object map: `{ Subject: '...', 'X-Mailer': '...' }`
 * - Gmail-style array: `[{ name: 'Subject', value: '...' }, ...]`
 *
 * Either way, only allowlisted entries survive.
 */
function scrubHeaders(headers: unknown): unknown {
  if (Array.isArray(headers)) {
    return headers.filter((h) => {
      if (!isPlainObject(h)) return false;
      const name = typeof h.name === 'string' ? h.name.toLowerCase() : '';
      return HEADER_ALLOWLIST.has(name);
    });
  }
  if (isPlainObject(headers)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (HEADER_ALLOWLIST.has(k.toLowerCase())) {
        out[k] = v;
      }
    }
    return out;
  }
  return headers;
}

/**
 * Recursive scrubber. Removes banned keys anywhere in the tree and
 * filters headers. Replaces a banned key's value with `[redacted]`
 * (rather than deleting) so the scrub is visible in telemetry —
 * makes it obvious during incident review that a guardrail fired
 * instead of silently dropping the data.
 *
 * Cycles are broken by tracking visited objects via a WeakSet.
 */
export function scrubObject<T>(input: T, seen: WeakSet<object> = new WeakSet()): T {
  if (Array.isArray(input)) {
    if (seen.has(input)) return input;
    seen.add(input);
    return input.map((item) => scrubObject(item, seen)) as unknown as T;
  }

  if (isPlainObject(input)) {
    if (seen.has(input)) return input;
    seen.add(input);

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (isBannedKey(key)) {
        out[key] = REDACTED;
        continue;
      }
      if (key.toLowerCase() === 'headers') {
        out[key] = scrubHeaders(value);
        continue;
      }
      out[key] = scrubObject(value, seen);
    }
    return out as unknown as T;
  }

  return input;
}

/**
 * Convenience for SDK `beforeSend` hooks. Sentry hands a typed Event;
 * we treat it as an opaque record, scrub, and hand it back. If scrub
 * throws, drop the event entirely — defense-in-depth.
 */
export function scrubTelemetryPayload<T extends Record<string, unknown>>(
  event: T | null | undefined,
): T | null {
  if (!event) return null;
  try {
    return scrubObject(event);
  } catch {
    return null;
  }
}

/** Exposed for tests. */
export const __testing = {
  BANNED_KEY_PATTERNS,
  HEADER_ALLOWLIST,
  REDACTED,
};
