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
 * Message-ID is NOT allowed in telemetry headers — D7's stored-header
 * allowlist (subject/from/to/cc/date/list-unsubscribe/list-unsubscribe-post)
 * defines the privacy boundary; telemetry must not be wider than DB storage.
 */
const HEADER_ALLOWLIST: ReadonlySet<string> = new Set(
  ['subject', 'from', 'to', 'cc', 'date', 'list-unsubscribe', 'list-unsubscribe-post'].map((h) =>
    h.toLowerCase(),
  ),
);

export const REDACTED = '[redacted]' as const;

export function isPlainObject(v: unknown): v is Record<string, unknown> {
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
 * REVISITS RETURN THE SCRUBBED COPY, not the input. The previous
 * revision tracked visited objects in a `WeakSet` and returned `input`
 * on a repeat — which is a bypass, not cycle-safety: the SECOND
 * appearance of an object came back raw. It did not need a cycle, only
 * a shared reference, and a shared reference serializes perfectly well
 * (a true cycle would have died in the SDK's own `JSON.stringify`). So
 * `{a: msg, b: msg}` shipped a full Gmail body under `b`. Found by
 * Codex stop-review, 2026-07-31, against `scrubUrlDerived`; the same
 * line had been here since the scrubber was written.
 *
 * A `WeakMap` keyed on the input holds the OUTPUT container, and the
 * container is registered BEFORE recursing — so a cycle resolves to
 * the scrubbed copy and the shape survives, while every node is
 * scrubbed exactly once.
 */
export function scrubObject<T>(input: T, seen: WeakMap<object, unknown> = new WeakMap()): T {
  if (Array.isArray(input)) {
    const cached = seen.get(input);
    if (cached !== undefined) return cached as T;
    const out: unknown[] = [];
    seen.set(input, out);
    for (const item of input) out.push(scrubObject(item, seen));
    return out as unknown as T;
  }

  if (isPlainObject(input)) {
    const cached = seen.get(input);
    if (cached !== undefined) return cached as T;
    const out: Record<string, unknown> = {};
    seen.set(input, out);
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
 * Query params allowed to survive on a URL in telemetry. Campaign
 * attribution only — everything else is dropped.
 *
 * WHY an allowlist. `scrubObject` above removes banned KEYS; it never
 * looks inside a string VALUE. PostHog's `$current_url` (and its
 * `$referrer` / `$initial_*` siblings) is a plain string carrying the
 * whole address bar, so a route like
 * `/activity?sender_q=someone@example.com` shipped that address to
 * PostHog on every automatic pageview — while the cookie banner
 * promises "PostHog receives product-usage events, never Gmail message
 * data". Found by Codex stop-review, 2026-07-31.
 *
 * A denylist of "sensitive-looking" params would need updating every
 * time a route gains one, and would have been written AFTER the leak.
 * Paths are unaffected: every dynamic segment in this app is a UUID
 * (`/senders/[id]`), so only the query is at risk.
 */
const TELEMETRY_QUERY_ALLOWLIST: ReadonlySet<string> = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
]);

/**
 * Allowed params must also carry an allowed VALUE. A name allowlist
 * constrains only who may speak, not what they may say: `?ref=` and
 * `?utm_content=` accept arbitrary text, so a malformed campaign link —
 * or a future route reusing one of these names — puts identity straight
 * through the gate. Campaign values are slugs and opaque click ids;
 * anything with `@`, `:`, `/` or `%` in it is not one.
 *
 * `ref` was in the name list and is gone: it is not a standard param
 * any analytics tool reads, and it was the loosest of the set.
 *
 * Deliberately lossy. An unusual campaign label is dropped from
 * analytics; an address is not shipped. That is the right direction for
 * a privacy boundary to fail in.
 */
const SAFE_CAMPAIGN_VALUE = /^[\w .\-+~]{1,96}$/;

/**
 * Reduce one string to its safe form IF it is an http(s) URL.
 *
 * REBUILT from an allowlist of components rather than stripped of the
 * parts we thought of. The strip version removed the query and left
 * FOUR other ways through, three of which shipped: the fragment
 * (`/activity#sender_q=<address>`, and a fragment-only URL skipped the
 * function entirely because it has no `?`), the values of allowed
 * params, and `user:pass@host` userinfo. Each was a separate patch
 * waiting to be requested; reconstruction closes the ones nobody has
 * thought of yet (Codex stop-review, 2026-07-31).
 *
 * Origin and path only, plus allowlisted query params with allowlisted
 * values. Every other component simply never gets copied.
 */
function stripUrlQuery(value: string): string {
  // Cheap reject before the parse — most telemetry strings are enums.
  if (!/^https?:\/\//i.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value; // not a URL after all; leave it exactly as it was
  }
  let safe: URL;
  try {
    // `host` carries the port but never the userinfo, and neither the
    // fragment nor the search is copied.
    safe = new URL(`${url.protocol}//${url.host}${url.pathname}`);
  } catch {
    return value;
  }
  for (const [key, param] of url.searchParams) {
    if (TELEMETRY_QUERY_ALLOWLIST.has(key.toLowerCase()) && SAFE_CAMPAIGN_VALUE.test(param)) {
      safe.searchParams.append(key, param);
    }
  }
  return safe.toString();
}

/**
 * Property keys that hold a campaign param the SDK PARSED OUT of the
 * URL. posthog-js lifts its whole campaign list into top-level
 * properties — `utm_content`, and a `$initial_utm_content` person
 * property that persists — beside `$current_url`.
 *
 * Cleaning the URL string alone is therefore not enough, and this is
 * exactly how the value allowlist above got defeated: for a visit to
 * `/?utm_content=someone@example.com` the address was removed from
 * `$current_url` and shipped anyway in `utm_content` (Codex
 * stop-review, 2026-07-31).
 *
 * `utm_[a-z_]+` is a pattern, not a list, because PostHog's set grows;
 * the click ids are enumerated because they share no prefix.
 */
const CAMPAIGN_CLICK_IDS: ReadonlyArray<string> = [
  'gclid',
  'gad_source',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'msclkid',
  'twclid',
  'li_fat_id',
  'mc_cid',
  'igshid',
  'ttclid',
  'rdt_cid',
  'irclid',
  '_kx',
  'epik',
  'qclid',
  'sccid',
];

/**
 * Match on the campaign NAME at the end of the key, whatever prefix the
 * SDK put in front of it.
 *
 * posthog-js keeps THREE copies of each param — the event property, the
 * `$initial_*` person property, and the `$session_entry_*` session
 * property — and adds prefixes over time. An earlier revision hardcoded
 * `(initial_)?` as the only prefix and `$session_entry_utm_content`
 * walked straight past it (Codex stop-review, 2026-07-31). Enumerating
 * prefixes is the same losing game as enumerating components was for
 * the URL itself; the name is the part that means something.
 */
function isCampaignPropertyKey(key: string): boolean {
  const k = key.replace(/^\$/, '').toLowerCase();
  if (/(^|_)utm_[a-z_]+$/.test(k)) return true;
  return CAMPAIGN_CLICK_IDS.some((name) => k === name || k.endsWith(`_${name}`));
}

/**
 * Remove URL-DERIVED identity from a payload — both the URL strings and
 * the properties an SDK parsed out of them.
 *
 * Named for the whole job on purpose. Its first name said "queries",
 * which is one component of one of the two channels, and both times a
 * guard in this file has been named for less than it guards, the gap
 * turned out to be where the leak lived (see `scrubObject`'s note on
 * `WeakSet`).
 *
 * URL strings are matched by SHAPE, at any depth and under any key: an
 * SDK adds `$referrer` / `$initial_current_url` / `$pathname` without
 * asking us, and a key allowlist would silently miss each new one.
 *
 * Repeat-visit handling is `scrubObject`'s — see the note there on why
 * a `WeakSet` is a bypass rather than cycle-safety.
 */
export function scrubUrlDerived<T>(input: T, seen: WeakMap<object, unknown> = new WeakMap()): T {
  if (typeof input === 'string') return stripUrlQuery(input) as unknown as T;
  if (Array.isArray(input)) {
    const cached = seen.get(input);
    if (cached !== undefined) return cached as T;
    const out: unknown[] = [];
    seen.set(input, out);
    for (const item of input) out.push(scrubUrlDerived(item, seen));
    return out as unknown as T;
  }
  if (isPlainObject(input)) {
    const cached = seen.get(input);
    if (cached !== undefined) return cached as T;
    const out: Record<string, unknown> = {};
    seen.set(input, out);
    for (const [key, value] of Object.entries(input)) {
      // The extracted copy answers to the SAME value rule as the query
      // it came from, or the rule is worth nothing.
      if (
        isCampaignPropertyKey(key) &&
        typeof value === 'string' &&
        !SAFE_CAMPAIGN_VALUE.test(value)
      ) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = scrubUrlDerived(value, seen);
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
    return scrubUrlDerived(scrubObject(event));
  } catch {
    return null;
  }
}
