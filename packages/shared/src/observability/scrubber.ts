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

/**
 * Sentry is intentionally stricter than the generic telemetry scrubber above.
 *
 * `scrubObject` remains the PostHog policy: preserve an allowlisted event's
 * shape while removing Gmail content keys. A Sentry exception, however, is
 * assembled by SDK integrations and can gain new fields after our call site.
 * Its wire policy is therefore deny-by-default: only the diagnostic structure
 * explicitly reconstructed below can leave the browser.
 */

const SENTRY_TAG_ALLOWLIST = new Set(['surface', 'reason', 'boundary']);
const SENTRY_BREADCRUMB_CATEGORIES = new Set([
  'sync',
  'action',
  'undo',
  'navigation',
  'mailbox',
  'auth',
]);
const SENTRY_BREADCRUMB_DATA_KEYS = new Set([
  'verb',
  'sender_count',
  'message_count',
  'token_count',
  'has_secondary',
  'older_than_days',
]);
const SENTRY_BREADCRUMB_VERBS = new Set(['keep', 'archive', 'unsubscribe', 'later', 'delete']);
const SENTRY_LEVELS = new Set(['fatal', 'error', 'warning', 'info', 'debug', 'log']);
const SENTRY_EXCEPTION_TYPES = new Set([
  'Error',
  'TypeError',
  'ReferenceError',
  'RangeError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'AggregateError',
  'DOMException',
  'AbortError',
  'NetworkError',
  'TimeoutError',
  'ChunkLoadError',
]);
const SENTRY_MECHANISM_TYPES = new Set([
  'generic',
  'auto.browser.global_handlers.onerror',
  'auto.browser.global_handlers.onunhandledrejection',
]);
const SAFE_TOKEN = /^[a-z][a-z0-9_-]{0,63}$/;
const SAFE_EVENT_ID = /^[a-fA-F0-9]{32}$/;
const SAFE_DEBUG_ID = /^[a-fA-F0-9-]{8,64}$/;
const SAFE_DIGEST = /^(?:\d{1,20}|[a-f0-9]{8,64})$/;
const SAFE_RELEASE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}(?:@[A-Za-z0-9][A-Za-z0-9._-]{0,127})?$/;
const TRUSTED_NEXT_ASSET =
  /^\/_next\/static\/(chunks|css)\/.*(?:-|\.)([a-f0-9]{8,64})\.(js|css)$/iu;

function copyString(value: unknown, pattern: RegExp, maxLength: number): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return undefined;
  return pattern.test(value) ? value : undefined;
}

function copyFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function copyNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Retain only a canonical identity for a hashed Next.js build asset.
 *
 * Route paths, origins, credentials, queries, and fragments can all contain
 * user data or capability tokens. Debug IDs preserve source-map resolution, so
 * a frame needs only its asset kind and immutable content hash on the wire.
 */
function sanitizeFrameUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4_096) return undefined;

  try {
    const parsed = new URL(value, 'https://declutrmail.invalid');
    const match = TRUSTED_NEXT_ASSET.exec(parsed.pathname);
    if (!match) return undefined;
    const [, kind, hash, extension] = match;
    if (!kind || !hash || !extension) return undefined;
    return `app:///_next/static/${kind.toLowerCase()}/${hash.toLowerCase()}.${extension.toLowerCase()}`;
  } catch {
    return undefined;
  }
}

function scrubSentryMechanism(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;

  const type =
    typeof value.type === 'string' && SENTRY_MECHANISM_TYPES.has(value.type)
      ? value.type
      : undefined;
  if (type === undefined) return undefined;

  const out: Record<string, unknown> = { type };
  for (const key of ['handled', 'synthetic', 'is_exception_group'] as const) {
    if (typeof value[key] === 'boolean') out[key] = value[key];
  }
  for (const key of ['exception_id', 'parent_id'] as const) {
    const id = copyNonNegativeInteger(value[key]);
    if (id !== undefined) out[key] = id;
  }
  return out;
}

function scrubSentryFrame(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;

  const out: Record<string, unknown> = {};
  for (const key of ['filename', 'abs_path'] as const) {
    const path = sanitizeFrameUrl(value[key]);
    if (path !== undefined) out[key] = path;
  }
  for (const key of ['lineno', 'colno'] as const) {
    const coordinate = copyNonNegativeInteger(value[key]);
    if (coordinate !== undefined) out[key] = coordinate;
  }
  if (typeof value.in_app === 'boolean') out.in_app = value.in_app;

  const debugId = copyString(value.debug_id, SAFE_DEBUG_ID, 64);
  if (debugId !== undefined) out.debug_id = debugId;

  return Object.keys(out).length > 0 ? out : undefined;
}

function scrubSentryStacktrace(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value) || !Array.isArray(value.frames)) return undefined;
  const frames = value.frames
    .map((frame) => scrubSentryFrame(frame))
    .filter((frame): frame is Record<string, unknown> => frame !== undefined);
  return frames.length > 0 ? { frames } : undefined;
}

function scrubSentryException(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;

  const out: Record<string, unknown> = {};
  const type =
    typeof value.type === 'string' && SENTRY_EXCEPTION_TYPES.has(value.type)
      ? value.type
      : undefined;
  const mechanism = scrubSentryMechanism(value.mechanism);
  const stacktrace = scrubSentryStacktrace(value.stacktrace);
  if (type !== undefined) out.type = type;
  if (mechanism !== undefined) out.mechanism = mechanism;
  if (stacktrace !== undefined) out.stacktrace = stacktrace;

  // Deliberately omit `value`: Sentry derives it from Error.message, which can
  // include email content, API responses, URLs, or other user-provided text.
  return Object.keys(out).length > 0 ? out : undefined;
}

function scrubSentryExceptions(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value) || !Array.isArray(value.values)) return undefined;
  const values = value.values
    .map((exception) => scrubSentryException(exception))
    .filter((exception): exception is Record<string, unknown> => exception !== undefined);
  return values.length > 0 ? { values } : undefined;
}

function scrubSentryTags(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;
  const tags: Record<string, unknown> = {};
  for (const key of SENTRY_TAG_ALLOWLIST) {
    const tag = copyString(value[key], SAFE_TOKEN, 64);
    if (tag !== undefined) tags[key] = tag;
  }
  return Object.keys(tags).length > 0 ? tags : undefined;
}

function scrubSentryDigest(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;
  const digest = copyString(value.digest, SAFE_DIGEST, 64);
  return digest === undefined ? undefined : { digest };
}

function scrubSentryDebugMeta(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value) || !Array.isArray(value.images)) return undefined;
  const images = value.images.flatMap((image) => {
    if (!isPlainObject(image)) return [];
    const type = copyString(image.type, SAFE_TOKEN, 64);
    const debugId = copyString(image.debug_id, SAFE_DEBUG_ID, 64);
    if (!type || !debugId) return [];
    const codeFile = sanitizeFrameUrl(image.code_file);
    return [
      { type, debug_id: debugId, ...(codeFile === undefined ? {} : { code_file: codeFile }) },
    ];
  });
  return images.length > 0 ? { images } : undefined;
}

function scrubSentryBreadcrumbData(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;

  const data: Record<string, unknown> = {};
  for (const key of SENTRY_BREADCRUMB_DATA_KEYS) {
    const item = value[key];
    if (key === 'verb') {
      if (typeof item === 'string' && SENTRY_BREADCRUMB_VERBS.has(item)) data[key] = item;
      continue;
    }
    if (key === 'has_secondary') {
      if (typeof item === 'boolean') data[key] = item;
      continue;
    }
    if (key === 'older_than_days' && item === null) {
      data[key] = null;
      continue;
    }
    const count = copyNonNegativeInteger(item);
    if (count !== undefined) data[key] = count;
  }
  return Object.keys(data).length > 0 ? data : undefined;
}

/**
 * Sanitize a manual DeclutrMail breadcrumb. SDK/automatic breadcrumbs do not
 * carry the `declutrmail.` marker and are dropped wholesale.
 */
export function scrubSentryBreadcrumb(
  breadcrumb: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!breadcrumb) return null;
  try {
    const category = typeof breadcrumb.category === 'string' ? breadcrumb.category : '';
    if (!category.startsWith('declutrmail.')) return null;
    const categorySuffix = category.slice('declutrmail.'.length);
    if (!SENTRY_BREADCRUMB_CATEGORIES.has(categorySuffix)) return null;

    const staticLabel = `declutrmail.${categorySuffix}`;
    const out: Record<string, unknown> = {
      category: staticLabel,
      message: staticLabel,
    };
    if (typeof breadcrumb.level === 'string' && SENTRY_LEVELS.has(breadcrumb.level)) {
      out.level = breadcrumb.level;
    }
    const timestamp = copyFiniteNumber(breadcrumb.timestamp);
    if (timestamp !== undefined) out.timestamp = timestamp;
    const data = scrubSentryBreadcrumbData(breadcrumb.data);
    if (data !== undefined) out.data = data;
    return out;
  } catch {
    return null;
  }
}

/**
 * Rebuild a browser Sentry event from the diagnostic fields DeclutrMail has
 * explicitly approved. Everything else fails closed.
 */
export function scrubSentryEvent(
  event: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!event) return null;
  try {
    // Sentry routes transactions through a different hook. Refuse every typed
    // envelope here so this function can never be mistaken for a transaction,
    // replay, profile, or feedback sanitizer.
    if (event.type !== undefined) return null;

    const out: Record<string, unknown> = {};

    const eventId = copyString(event.event_id, SAFE_EVENT_ID, 32);
    if (eventId !== undefined) out.event_id = eventId;
    const timestamp = copyFiniteNumber(event.timestamp);
    if (timestamp !== undefined) out.timestamp = timestamp;
    if (typeof event.level === 'string' && SENTRY_LEVELS.has(event.level)) out.level = event.level;
    const release = copyString(event.release, SAFE_RELEASE, 256);
    if (release !== undefined) out.release = release;
    if (typeof event.environment === 'string' && SAFE_TOKEN.test(event.environment)) {
      out.environment = event.environment;
    }

    const exception = scrubSentryExceptions(event.exception);
    if (exception !== undefined) out.exception = exception;
    const tags = scrubSentryTags(event.tags);
    if (tags !== undefined) out.tags = tags;
    const digest = scrubSentryDigest(event.extra);
    if (digest !== undefined) out.extra = digest;
    const debugMeta = scrubSentryDebugMeta(event.debug_meta);
    if (debugMeta !== undefined) out.debug_meta = debugMeta;

    if (Array.isArray(event.breadcrumbs)) {
      const breadcrumbs = event.breadcrumbs
        .map((breadcrumb) => (isPlainObject(breadcrumb) ? scrubSentryBreadcrumb(breadcrumb) : null))
        .filter((breadcrumb): breadcrumb is Record<string, unknown> => breadcrumb !== null);
      if (breadcrumbs.length > 0) out.breadcrumbs = breadcrumbs;
    }

    return out;
  } catch {
    return null;
  }
}

/** Exposed for tests. */
export const __testing = {
  BANNED_KEY_PATTERNS,
  HEADER_ALLOWLIST,
  REDACTED,
  SENTRY_TAG_ALLOWLIST,
  SENTRY_BREADCRUMB_CATEGORIES,
  SENTRY_BREADCRUMB_DATA_KEYS,
  SENTRY_EXCEPTION_TYPES,
  SENTRY_MECHANISM_TYPES,
  SAFE_DIGEST,
  SAFE_RELEASE,
  TRUSTED_NEXT_ASSET,
};
