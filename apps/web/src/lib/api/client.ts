/**
 * HTTP API client (D200, D201, D202).
 *
 * Thin fetch wrapper that every TanStack Query hook in `apps/web` goes
 * through. Responsibilities:
 *
 *   1. Resolve the API base URL from `NEXT_PUBLIC_API_URL` (set in
 *      `.env.local`). Path-only requests are joined; absolute URLs pass
 *      through.
 *   2. Stamp the per-mailbox auth header — `x-mailbox-account-id`. This
 *      is the INTERIM mailbox-identity scheme used until D109/D224 land
 *      the proper session layer. Source order:
 *        - `NEXT_PUBLIC_DEMO_MAILBOX_ACCOUNT_ID` env var (build-time),
 *        - then the literal `'demo'` (Storybook + first-run dev),
 *      so a Storybook session that never set the env var still resolves
 *      against fixture-fed MSW handlers.
 *   3. Parse the D202 envelope. Successful responses unwrap to
 *      `Envelope<T>` so callers receive the raw `data` plus optional
 *      `meta` — never the raw `Response`. Failed responses throw an
 *      `ApiError` carrying the status + parsed body so callers (and
 *      TanStack Query) can branch on `error instanceof ApiError`.
 *
 * Why a single client instead of letting each hook call `fetch` directly?
 * Because the auth header and the envelope unwrap are concerns that
 * recur on every endpoint — inlining them at each call site is exactly
 * the kind of drift D200 + D202 are designed to prevent (see also
 * `packages/shared/src/contracts/envelope.ts`).
 *
 * Auth note (INTERIM). The `x-mailbox-account-id` header is a
 * placeholder for the real session — once D109/D224 land, this client
 * swaps to reading the mailbox id from the session JWT and the header
 * is dropped from the wire. The BE accepts both during the transition.
 */

import type { Envelope } from '@declutrmail/shared/contracts';

/** Resolves the API base URL from the public env var. Empty string allows path-only fetches. */
function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? '';
}

/**
 * Resolves the demo mailbox account id used by `x-mailbox-account-id`
 * during the pre-session-layer interim. Falls back to `'demo'` so
 * Storybook and ad-hoc dev work without env wiring.
 */
function getMailboxAccountId(): string {
  return process.env.NEXT_PUBLIC_DEMO_MAILBOX_ACCOUNT_ID ?? 'demo';
}

/**
 * Error thrown for any non-2xx response. Carries the status code and
 * the parsed body (best effort) so callers can branch on `status` or
 * read a structured error message from `body`. TanStack Query's
 * `error` channel surfaces this verbatim — components can do
 * `if (error instanceof ApiError && error.status === 404) ...`.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Options passed straight to `fetch` plus an optional query-string map.
 *
 * All optional fields explicitly allow `undefined` so call sites can
 * forward `useQuery`'s `signal` (which can be undefined) without
 * tripping `exactOptionalPropertyTypes`.
 */
export interface ApiRequestOptions {
  /** Query string params. `undefined` values are omitted; everything else stringified. */
  query?: Record<string, string | number | boolean | null | undefined> | undefined;
  /** Additional headers — merged on top of the defaults. */
  headers?: Record<string, string> | undefined;
  /** Abort signal forwarded to `fetch`. */
  signal?: AbortSignal | undefined;
}

/** Joins `?k=v` pairs onto a path. Skips entries whose value is null/undefined. */
function buildUrl(path: string, query: ApiRequestOptions['query']): string {
  const base = getApiBaseUrl();
  const url = path.startsWith('http') ? path : `${base}${path}`;
  if (!query) return url;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    usp.set(k, String(v));
  }
  const qs = usp.toString();
  return qs.length === 0 ? url : `${url}?${qs}`;
}

/**
 * GET an endpoint and return the unwrapped D202 envelope payload.
 *
 * Two return paths are mutually exclusive — successful 2xx returns the
 * parsed envelope; anything else throws `ApiError`. We deliberately do
 * NOT throw on a missing `data` field — that's a contract violation
 * worth surfacing to the caller as a runtime error so the BE author
 * sees it during integration.
 *
 * The body parse is forgiving — if the server returns non-JSON on an
 * error response, we attach the raw text to `ApiError.body` so the
 * caller can still log it.
 */
export async function apiGet<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Envelope<T, unknown>> {
  const url = buildUrl(path, options.query);
  // Build the `RequestInit` carefully — `exactOptionalPropertyTypes`
  // rejects `signal: undefined`, so we only attach when defined.
  const init: RequestInit = {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'x-mailbox-account-id': getMailboxAccountId(),
      ...(options.headers ?? {}),
    },
  };
  if (options.signal != null) init.signal = options.signal;
  const res = await fetch(url, init);

  // Read the body once — JSON if possible, raw text otherwise. The two
  // branches share the same `text` so an error response with malformed
  // JSON still attaches the original bytes for debugging.
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, parsed, `GET ${path} failed: ${res.status} ${res.statusText}`);
  }

  // D202 envelope guard — anything that doesn't carry a `data` field is
  // a contract bug. Surface it as a runtime error rather than coercing.
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Object.prototype.hasOwnProperty.call(parsed, 'data')
  ) {
    throw new ApiError(
      res.status,
      parsed,
      `GET ${path} returned a non-envelope payload — expected { data, meta? }`,
    );
  }

  return parsed as Envelope<T, unknown>;
}
