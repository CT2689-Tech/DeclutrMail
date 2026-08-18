// @declutrmail/shared/observability — Sentry wire scrubbers (D7/D228).
//
// Split out of `scrubber.ts` (D160, 2026-08-18) so the eager browser
// path does not carry them. `apps/web/src/lib/posthog.ts` needs only
// `scrubObject` + `scrubTelemetryPayload`, but a bundler cannot drop
// unused exports from WITHIN a module — importing either symbol pulled
// this entire Sentry half into a first-load chunk on every route that
// loads PostHog. `sentry-browser-runtime.ts`, the only browser consumer
// of these, is already behind a dynamic import, so after the split they
// ship only in that lazy chunk.

import { isPlainObject, REDACTED } from './scrubber.js';

/**
 * Sentry is intentionally stricter than the generic telemetry scrubber
 * in `scrubber.ts`.
 *
 * `scrubObject` remains the PostHog policy: preserve an allowlisted event's
 * shape while removing Gmail content keys. A Sentry exception, however, is
 * assembled by SDK integrations and can gain new fields after our call site.
 * Its wire policy is therefore deny-by-default: only the diagnostic structure
 * explicitly reconstructed below can leave the browser.
 */

const SENTRY_TAG_ALLOWLIST = new Set(['surface', 'reason', 'boundary']);
/**
 * Server profile (D158 chore batch, 2026-07-28): the API/worker events
 * carry triage tags the browser never sets — dropping them would gut
 * the D159 failure-triage workflow, so the server profile allowlists
 * them explicitly rather than widening the browser set. Values still
 * pass SAFE_SERVER_TAG (ids/tokens only, never free text).
 */
const SENTRY_SERVER_TAG_ALLOWLIST = new Set([
  ...SENTRY_TAG_ALLOWLIST,
  'worker',
  'policy',
  'job_id',
  'mailbox_account_id',
  'kind',
  // Upstream provider reason (Gmail `error.errors[0].reason`). A closed
  // vendor enum — `SAFE_SERVER_TAG` still rejects anything with a space or
  // an '@', so no prose can ride in on it. Added 2026-08-06: with
  // `Error.message` omitted by design, a terminal worker failure otherwise
  // reached Sentry as a bare class name and took a production database
  // query to identify.
  'error_reason',
]);
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
/**
 * Sentry LOG severities. Deliberately a separate set from
 * `SENTRY_LEVELS`: the log protocol uses `warn`/`trace`, the event
 * protocol uses `warning`/`log`. Reusing one set would silently drop
 * every warn-level log.
 */
const SENTRY_LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
/**
 * The closed set of notices allowed on the Sentry LOGS channel.
 *
 * A log is not an error. These are recorded-state notifications —
 * `dead_letter.parked` announces a row that is already durable in
 * `dead_letter_jobs`; `email.refused_no_postal_address` is a DESIGNED
 * refusal (CAN-SPAM §316.5). Neither is a crash, and both were consuming
 * the errors quota, which is the only Sentry budget that runs out: at the
 * 2026-08-18 incident errors sat at 4,000/5,000 while logs sat at 0 of
 * 5 GB.
 *
 * Deny-by-default: a log whose `kind` is not here never leaves the
 * process. Adding a kind is the same kind of decision as adding a tag to
 * `SENTRY_SERVER_TAG_ALLOWLIST` — it must be a closed enum, never a
 * caller-supplied string.
 */
const SENTRY_LOG_KINDS = new Set(['dead_letter.parked', 'email.refused_no_postal_address']);
/**
 * Attributes a log may carry. Same posture and same value gate as
 * `SENTRY_SERVER_TAG_ALLOWLIST` — ids and closed enums only, never prose.
 *
 * `email_kind` and `outcome` are here because the refusal call site has
 * been passing them (as `emailKind`/`outcome`) since it was written and
 * the event-tag allowlist never carried them, so they were being dropped
 * exactly like `queue` was (#546).
 */
const SENTRY_LOG_ATTRIBUTE_ALLOWLIST = new Set([
  'kind',
  'queue',
  'dead_letter_id',
  'job_id',
  'worker',
  'policy',
  'mailbox_account_id',
  'email_kind',
  'outcome',
  'failed_at',
  // WHICH error class parked the row. With `queue` this is the whole
  // diagnosis; a bare class name is not prose and cannot carry content.
  'error_class',
]);
/**
 * Server error classes (thrown by workers/API): named so the exception
 * `type` survives the rebuild — the stacktrace identifies the site, the
 * type identifies the class of failure. `value` (Error.message) stays
 * deliberately omitted in BOTH profiles.
 */
const SENTRY_SERVER_EXCEPTION_TYPES = new Set([
  'AppException',
  'ValidationError',
  'TransientError',
  'PermanentError',
  'RateLimitError',
  'InvalidGrantError',
  'EmailRaceLostError',
  'ReplyError',
  'ZodError',
]);
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
// Server tag values: worker job ids and mailbox uuids include uppercase
// hex, colons and dots (BullMQ ids) — still tokens, never prose (no
// spaces, no '@', bounded).
const SAFE_SERVER_TAG = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const SAFE_EVENT_ID = /^[a-fA-F0-9]{32}$/;
const SAFE_DEBUG_ID = /^[a-fA-F0-9-]{8,64}$/;
const SAFE_DIGEST = /^(?:\d{1,20}|[a-f0-9]{8,64})$/;
const SAFE_RELEASE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}(?:@[A-Za-z0-9][A-Za-z0-9._-]{0,127})?$/;
const TRUSTED_NEXT_ASSET =
  /^\/_next\/static\/(chunks|css)\/.*(?:-|\.)([a-f0-9]{8,64})\.(js|css)$/iu;
/**
 * A server stack frame's source path.
 *
 * `sanitizeFrameUrl` only ever matched `/_next/static/**` — a BROWSER
 * pattern — so every server frame lost its filename and arrived as a bare
 * `lineno:colno`. Combined with `function` never being copied, every
 * server stacktrace in Sentry read `at <unknown> (<unknown>:566:32)`: a
 * line number, in an unknown file, in an unknown function. Triaging the
 * 2026-08-18 drift-sweep incident took an hour of tag arithmetic for want
 * of this (D159).
 *
 * A source path is a compile-time constant of OUR OWN build output — it
 * cannot contain an email address, a subject, or any user text, so
 * keeping it costs nothing against D7. The pattern stays deliberately
 * narrow anyway: a relative-looking path, a conservative charset, a
 * JS/TS extension, and NO query string, host, or userinfo (checked via
 * `URL` in `sanitizeFrameUrl`) so a frame cannot smuggle data in a path.
 */
const SAFE_SERVER_FRAME_PATH =
  /^\/?(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:js|mjs|cjs|ts|mts|cts)$/u;
/**
 * A stack frame's function name — `processJob`, `Worker.run`,
 * `async DeadLetterWorker.processJob`, `Object.<anonymous>`.
 *
 * Also a source-level identifier, never user data, and the other half of
 * why frames were unreadable: it was copied in NEITHER profile. The
 * charset admits the punctuation V8 puts in a frame name and nothing
 * else — no quotes, no '@', no whitespace beyond the single space in
 * `async`/`new` prefixes.
 */
const SAFE_FRAME_FUNCTION = /^[A-Za-z0-9_$.<>[\] ]{1,120}$/u;

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
function sanitizeFrameUrl(value: unknown, profile: SentryScrubProfile): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4_096) return undefined;

  try {
    // Parsing first is what makes the path safe to keep: anything with a
    // host, userinfo, query, or fragment is reduced to its pathname here,
    // so those can never ride along even if the charset would allow them.
    const parsed = new URL(value, 'https://declutrmail.invalid');
    const match = TRUSTED_NEXT_ASSET.exec(parsed.pathname);
    if (match) {
      const [, kind, hash, extension] = match;
      if (!kind || !hash || !extension) return undefined;
      return `app:///_next/static/${kind.toLowerCase()}/${hash.toLowerCase()}.${extension.toLowerCase()}`;
    }
    if (profile !== 'server') return undefined;
    // Server build output — `/app/dist/worker.js`, `app:///worker.js`,
    // `/app/node_modules/bullmq/…`. Normalised to `app:///<path>` so
    // Sentry treats it as an application path (and so an uploaded source
    // map can resolve it later).
    const pathname = decodeURIComponent(parsed.pathname);
    if (!SAFE_SERVER_FRAME_PATH.test(pathname)) return undefined;
    return `app:///${pathname.replace(/^\/+/, '').replace(/^app\//, '')}`;
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

function scrubSentryFrame(
  value: unknown,
  profile: SentryScrubProfile,
): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;

  const out: Record<string, unknown> = {};
  for (const key of ['filename', 'abs_path'] as const) {
    const path = sanitizeFrameUrl(value[key], profile);
    if (path !== undefined) out[key] = path;
  }
  // The frame's function name — the other half of why server frames were
  // unreadable: without it, even a frame that keeps its filename still
  // renders `at <unknown>`. A source-level identifier, never user data.
  //
  // SERVER ONLY. The browser profile's narrowness is deliberate (it ships
  // to a wire the user's own page can influence) and browser frame names
  // are minified to `a`/`Kn` anyway, so widening it would add risk and no
  // legibility.
  if (profile === 'server') {
    const fn = copyString(value.function, SAFE_FRAME_FUNCTION, 120);
    if (fn !== undefined) out.function = fn;
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

function scrubSentryStacktrace(
  value: unknown,
  profile: SentryScrubProfile,
): Record<string, unknown> | undefined {
  if (!isPlainObject(value) || !Array.isArray(value.frames)) return undefined;
  const frames = value.frames
    .map((frame) => scrubSentryFrame(frame, profile))
    .filter((frame): frame is Record<string, unknown> => frame !== undefined);
  return frames.length > 0 ? { frames } : undefined;
}

function scrubSentryException(
  value: unknown,
  profile: SentryScrubProfile,
): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;

  const out: Record<string, unknown> = {};
  const type =
    typeof value.type === 'string' &&
    (SENTRY_EXCEPTION_TYPES.has(value.type) ||
      (profile === 'server' && SENTRY_SERVER_EXCEPTION_TYPES.has(value.type)))
      ? value.type
      : undefined;
  const mechanism = scrubSentryMechanism(value.mechanism);
  const stacktrace = scrubSentryStacktrace(value.stacktrace, profile);
  if (type !== undefined) out.type = type;
  if (mechanism !== undefined) out.mechanism = mechanism;
  if (stacktrace !== undefined) out.stacktrace = stacktrace;

  // Deliberately omit `value`: Sentry derives it from Error.message, which can
  // include email content, API responses, URLs, or other user-provided text.
  return Object.keys(out).length > 0 ? out : undefined;
}

function scrubSentryExceptions(
  value: unknown,
  profile: SentryScrubProfile,
): Record<string, unknown> | undefined {
  if (!isPlainObject(value) || !Array.isArray(value.values)) return undefined;
  const values = value.values
    .map((exception) => scrubSentryException(exception, profile))
    .filter((exception): exception is Record<string, unknown> => exception !== undefined);
  return values.length > 0 ? { values } : undefined;
}

function scrubSentryTags(
  value: unknown,
  profile: SentryScrubProfile,
): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;
  const allowlist = profile === 'server' ? SENTRY_SERVER_TAG_ALLOWLIST : SENTRY_TAG_ALLOWLIST;
  const pattern = profile === 'server' ? SAFE_SERVER_TAG : SAFE_TOKEN;
  const tags: Record<string, unknown> = {};
  for (const key of allowlist) {
    const tag = copyString(value[key], pattern, 64);
    if (tag !== undefined) tags[key] = tag;
  }
  return Object.keys(tags).length > 0 ? tags : undefined;
}

function scrubSentryDigest(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;
  const digest = copyString(value.digest, SAFE_DIGEST, 64);
  return digest === undefined ? undefined : { digest };
}

function scrubSentryDebugMeta(
  value: unknown,
  profile: SentryScrubProfile,
): Record<string, unknown> | undefined {
  if (!isPlainObject(value) || !Array.isArray(value.images)) return undefined;
  const images = value.images.flatMap((image) => {
    if (!isPlainObject(image)) return [];
    const type = copyString(image.type, SAFE_TOKEN, 64);
    const debugId = copyString(image.debug_id, SAFE_DEBUG_ID, 64);
    if (!type || !debugId) return [];
    const codeFile = sanitizeFrameUrl(image.code_file, profile);
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
 * Deny-by-default scrubber for the Sentry LOGS channel (`beforeSendLog`).
 *
 * `beforeSend` does NOT run on logs. Enabling logs without this would
 * open a second, unscrubbed egress path to Sentry — and a log's
 * `message` is free text, the exact hazard `Error.message` is stripped
 * for (it could carry a subject line or an address).
 *
 * So the message is never passed through: it is RECONSTRUCTED from an
 * allowlisted `kind`, the same technique `scrubSentryBreadcrumb` uses for
 * its category. A log's text can therefore only ever be one of the
 * strings in `SENTRY_LOG_KINDS` — there is no free-text path at all, no
 * matter what a caller writes.
 *
 * Returns `null` (drop the log) unless it carries a recognised `kind`.
 */
export function scrubSentryLog(
  log: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!log) return null;
  try {
    const rawAttributes = isPlainObject(log.attributes) ? log.attributes : {};
    const kind = typeof rawAttributes.kind === 'string' ? rawAttributes.kind : '';
    if (!SENTRY_LOG_KINDS.has(kind)) return null;

    const attributes: Record<string, unknown> = {};
    for (const key of SENTRY_LOG_ATTRIBUTE_ALLOWLIST) {
      const value = copyString(rawAttributes[key], SAFE_SERVER_TAG, 64);
      if (value !== undefined) attributes[key] = value;
    }

    return {
      // Static label, NOT `log.message`. This is the privacy boundary.
      message: kind,
      level:
        typeof log.level === 'string' && SENTRY_LOG_LEVELS.has(log.level) ? log.level : 'error',
      attributes,
    };
  } catch {
    return null;
  }
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

/** Which side of the wire the event came from — selects the allowlists. */
export type SentryScrubProfile = 'browser' | 'server';

/**
 * Rebuild a Sentry event from the diagnostic fields DeclutrMail has
 * explicitly approved. Everything else fails closed. The `server`
 * profile (D158, 2026-07-28) additionally admits the worker/API triage
 * tags and server error class names; `Error.message` stays omitted in
 * BOTH profiles — it is the field a future \`throw new Error(\${subject})\`
 * would leak through.
 */
export function scrubSentryEvent(
  event: Record<string, unknown> | null | undefined,
  profile: SentryScrubProfile = 'browser',
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

    const exception = scrubSentryExceptions(event.exception, profile);
    if (exception !== undefined) out.exception = exception;
    const tags = scrubSentryTags(event.tags, profile);
    if (tags !== undefined) out.tags = tags;
    const digest = scrubSentryDigest(event.extra);
    if (digest !== undefined) out.extra = digest;
    const debugMeta = scrubSentryDebugMeta(event.debug_meta, profile);
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

/**
 * Sentry TRANSACTION (tracing) sanitizer — the `beforeSendTransaction` seam.
 *
 * Tracing is the one signal that shows a FAILURE IN CONTEXT: which request,
 * which job, which query, in what order. That is exactly what was missing
 * on 2026-08-18, when a five-minute retry loop had to be reconstructed by
 * hand from tag values and arithmetic.
 *
 * It is also the signal that carries the most user data by default, which
 * is why D7/D228 had traces off entirely until now. Three rules make it
 * safe, and all three are deny-by-default:
 *
 *   1. `description` is DROPPED, never sanitized. It is where a span puts
 *      free text — the literal SQL (`WHERE email = 'a@b.com'`), the full
 *      request URL, the cache key. There is no pattern that reliably
 *      separates safe descriptions from unsafe ones, so none is attempted.
 *      The span tree keeps its SHAPE (op, timing, parent/child, count),
 *      which is what makes a runaway loop or an N+1 visible.
 *   2. `op` must be in a closed set. An unrecognised op drops the span
 *      rather than the field, because an op we do not know is a span whose
 *      data shape we have not reviewed.
 *   3. `data` is key-allowlisted with the same `SAFE_SERVER_TAG` value gate
 *      as tags — ids and closed enums, never prose.
 *
 * The transaction NAME is route-shaped or nothing: query strings are cut
 * (they carry search terms), and anything with an `@` is refused outright.
 */
export function scrubSentryTransaction(
  event: Record<string, unknown> | null | undefined,
  profile: SentryScrubProfile = 'browser',
): Record<string, unknown> | null {
  if (!event) return null;
  try {
    // The mirror of `scrubSentryEvent`'s guard: that function refuses typed
    // envelopes, this one accepts ONLY transactions. Neither can be handed
    // the other's payload by a mis-wired hook.
    if (event.type !== 'transaction') return null;

    const out: Record<string, unknown> = { type: 'transaction' };

    const eventId = copyString(event.event_id, SAFE_EVENT_ID, 32);
    if (eventId !== undefined) out.event_id = eventId;
    for (const key of ['timestamp', 'start_timestamp'] as const) {
      const value = copyFiniteNumber(event[key]);
      if (value !== undefined) out[key] = value;
    }
    const release = copyString(event.release, SAFE_RELEASE, 256);
    if (release !== undefined) out.release = release;
    if (typeof event.environment === 'string' && SAFE_TOKEN.test(event.environment)) {
      out.environment = event.environment;
    }

    const name = sanitizeTransactionName(event.transaction);
    // No legible name means no useful transaction — and a name we refused is
    // a name we could not prove safe. Drop the whole envelope.
    if (name === undefined) return null;
    out.transaction = name;

    const tags = scrubSentryTags(event.tags, profile);
    if (tags !== undefined) out.tags = tags;

    const trace = scrubSentryTraceContext(event.contexts);
    if (trace !== undefined) out.contexts = { trace };

    if (Array.isArray(event.spans)) {
      const spans = event.spans
        .map((span) => (isPlainObject(span) ? scrubSentrySpan(span) : null))
        .filter((span): span is Record<string, unknown> => span !== null)
        .slice(0, MAX_SPANS_PER_TRANSACTION);
      if (spans.length > 0) out.spans = spans;
    }

    return out;
  } catch {
    return null;
  }
}

/**
 * Cap on spans forwarded per transaction. A runaway loop can produce
 * thousands; the first 500 already show the shape, and an unbounded array
 * is an unbounded payload.
 */
const MAX_SPANS_PER_TRANSACTION = 500;

/**
 * Route-shaped names only.
 *
 * Query strings carry search terms (`?q=...`) and are cut before matching,
 * not after — a name is judged on what survives, never on what arrived.
 * An `@` anywhere is an email address until proven otherwise, so it is
 * refused rather than masked.
 */
function sanitizeTransactionName(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return undefined;
  const withoutQuery = value.split(/[?#]/, 1)[0] ?? '';
  if (withoutQuery.length === 0 || withoutQuery.includes('@')) return undefined;
  return SAFE_TRANSACTION_NAME.test(withoutQuery) ? withoutQuery : undefined;
}

/** `GET /api/v1/senders/:id`, `/triage`, or a bare worker/job label. */
const SAFE_TRANSACTION_NAME = /^(?:[A-Z]{3,7} )?[A-Za-z0-9/_:.\-{}[\]]{1,160}$/;

/**
 * Span operations permitted on the wire.
 *
 * Closed by design: an op absent here is a span whose `data` shape has not
 * been reviewed against D7, so the span is dropped rather than partially
 * copied. Widening this set is the same class of decision as widening
 * `SENTRY_SERVER_TAG_ALLOWLIST`.
 */
const SENTRY_SPAN_OPS = new Set([
  'http.server',
  'http.client',
  'db',
  'db.query',
  'db.sql.query',
  'db.redis',
  'cache.get',
  'cache.put',
  'queue.publish',
  'queue.process',
  'function',
  'middleware.nestjs',
  'request',
  'pageload',
  'navigation',
  'resource.script',
  'resource.css',
  'ui.render',
  'browser',
]);

/**
 * Span `data` keys allowed on the wire — the OpenTelemetry attributes that
 * are structural (method, status, system) rather than content. Notably
 * absent: `db.statement`, `http.url`, `http.target`, and every other key
 * whose value is free text or a full URL.
 */
const SENTRY_SPAN_DATA_ALLOWLIST = new Set([
  'http.request.method',
  'http.response.status_code',
  'db.system',
  'db.operation',
  'server.address',
  'queue.name',
  'worker',
  'policy',
  'sentry.origin',
  'sentry.op',
]);

/** Copy a span's structure — never its description. */
function scrubSentrySpan(span: Record<string, unknown>): Record<string, unknown> | null {
  const op = typeof span.op === 'string' && SENTRY_SPAN_OPS.has(span.op) ? span.op : undefined;
  if (op === undefined) return null;

  const out: Record<string, unknown> = { op };
  const spanId = copyString(span.span_id, SAFE_SPAN_ID, 16);
  if (spanId !== undefined) out.span_id = spanId;
  const parentSpanId = copyString(span.parent_span_id, SAFE_SPAN_ID, 16);
  if (parentSpanId !== undefined) out.parent_span_id = parentSpanId;
  const traceId = copyString(span.trace_id, SAFE_TRACE_ID, 32);
  if (traceId !== undefined) out.trace_id = traceId;
  for (const key of ['timestamp', 'start_timestamp'] as const) {
    const value = copyFiniteNumber(span[key]);
    if (value !== undefined) out[key] = value;
  }
  if (typeof span.status === 'string' && SAFE_TOKEN.test(span.status)) out.status = span.status;

  if (isPlainObject(span.data)) {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(span.data)) {
      if (!SENTRY_SPAN_DATA_ALLOWLIST.has(key)) continue;
      if (typeof value === 'number' && Number.isFinite(value)) {
        data[key] = value;
        continue;
      }
      const safe = copyString(value, SAFE_SERVER_TAG, 64);
      if (safe !== undefined) data[key] = safe;
    }
    if (Object.keys(data).length > 0) out.data = data;
  }

  return out;
}

/** The trace context — ids and op only; `description` never travels. */
function scrubSentryTraceContext(contexts: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(contexts) || !isPlainObject(contexts.trace)) return undefined;
  const trace = contexts.trace;
  const out: Record<string, unknown> = {};
  const traceId = copyString(trace.trace_id, SAFE_TRACE_ID, 32);
  if (traceId !== undefined) out.trace_id = traceId;
  const spanId = copyString(trace.span_id, SAFE_SPAN_ID, 16);
  if (spanId !== undefined) out.span_id = spanId;
  if (typeof trace.op === 'string' && SENTRY_SPAN_OPS.has(trace.op)) out.op = trace.op;
  if (typeof trace.status === 'string' && SAFE_TOKEN.test(trace.status)) out.status = trace.status;
  return Object.keys(out).length > 0 ? out : undefined;
}

const SAFE_SPAN_ID = /^[a-f0-9]{16}$/;
const SAFE_TRACE_ID = /^[a-f0-9]{32}$/;

/** Exposed for tests. */
export const __testing = {
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
