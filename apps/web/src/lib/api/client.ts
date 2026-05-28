/**
 * HTTP API client (D155, D200, D201, D202).
 *
 * Thin fetch wrapper that every TanStack Query hook in `apps/web` goes
 * through. Responsibilities:
 *
 *   1. Resolve the API base URL from `NEXT_PUBLIC_API_URL` (set in
 *      `.env.local`). Path-only requests are joined; absolute URLs pass
 *      through.
 *   2. Cookie auth: every request is `credentials: 'include'` so the
 *      HttpOnly session cookies (`dm_access`, `dm_refresh`) ride along.
 *      The client also reads the non-HttpOnly `dm_csrf` cookie and
 *      attaches it as the `X-CSRF-Token` header on every mutating verb
 *      — the BE `CsrfGuard` (apps/api/src/auth/csrf.guard.ts) requires
 *      the double-submit value to match.
 *   3. Per-request mailbox override: when a hook explicitly passes
 *      `mailboxId`, the client stamps `X-Active-Mailbox-Id` so the BE
 *      reads from that mailbox instead of the user's preferred default.
 *   4. 401 retry-once-via-refresh: a single rotation through
 *      `POST /api/auth/refresh` is attempted on the first 401; a second
 *      401 surfaces as an `ApiError` so the caller can route to login.
 *   5. Parse the D202 envelope. Successful responses unwrap to
 *      `Envelope<T>` so callers receive the raw `data` plus optional
 *      `meta` — never the raw `Response`. Failed responses throw an
 *      `ApiError` carrying the status + parsed body so callers (and
 *      TanStack Query) can branch on `error instanceof ApiError`.
 */

import type { Envelope } from '@declutrmail/shared/contracts';

/** Resolves the API base URL from the public env var. Empty string allows path-only fetches. */
function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? '';
}

/** Read a cookie by name. Browser-only — returns null in SSR/Node. */
function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const target = `${name}=`;
  const parts = document.cookie.split('; ');
  for (const part of parts) {
    if (part.startsWith(target)) {
      return decodeURIComponent(part.slice(target.length));
    }
  }
  return null;
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
  /**
   * Optional per-request mailbox override — stamps `X-Active-Mailbox-Id`.
   * When omitted, the BE resolves the user's preferred mailbox from
   * `users.preferences.activeMailboxId` (set via the account switcher).
   */
  mailboxId?: string | undefined;
  /**
   * Internal: disable the 401-retry path when the call IS the retry.
   * Library callers leave this unset.
   */
  _isRetry?: boolean | undefined;
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

export async function apiGet<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Envelope<T, unknown>> {
  return apiRequest<T>('GET', path, undefined, options);
}

export async function apiPost<T>(
  path: string,
  body?: unknown,
  options: ApiRequestOptions = {},
): Promise<Envelope<T, unknown>> {
  return apiRequest<T>('POST', path, body, options);
}

export async function apiPatch<T>(
  path: string,
  body?: unknown,
  options: ApiRequestOptions = {},
): Promise<Envelope<T, unknown>> {
  return apiRequest<T>('PATCH', path, body, options);
}

export async function apiDelete<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Envelope<T, unknown>> {
  return apiRequest<T>('DELETE', path, undefined, options);
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  options: ApiRequestOptions,
): Promise<Envelope<T, unknown>> {
  const url = buildUrl(path, options.query);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers ?? {}),
  };
  // CSRF double-submit on every mutating verb (D155 CsrfGuard).
  if (MUTATING_METHODS.has(method)) {
    const csrf = readCookie('dm_csrf');
    if (csrf) {
      headers['X-CSRF-Token'] = csrf;
    }
  }
  if (options.mailboxId) {
    headers['X-Active-Mailbox-Id'] = options.mailboxId;
  }
  const init: RequestInit = { method, headers, credentials: 'include' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (options.signal != null) init.signal = options.signal;
  const res = await fetch(url, init);

  // Read the body once — JSON if possible, raw text otherwise.
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
    // 401 → attempt refresh once. If the refresh succeeds the caller's
    // request is replayed; if it fails the original 401 surfaces.
    if (res.status === 401 && !options._isRetry && path !== '/api/auth/refresh') {
      const refreshed = await attemptRefresh();
      if (refreshed) {
        return apiRequest<T>(method, path, body, { ...options, _isRetry: true });
      }
    }
    throw new ApiError(
      res.status,
      parsed,
      `${method} ${path} failed: ${res.status} ${res.statusText}`,
    );
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Object.prototype.hasOwnProperty.call(parsed, 'data')
  ) {
    throw new ApiError(
      res.status,
      parsed,
      `${method} ${path} returned a non-envelope payload — expected { data, meta? }`,
    );
  }

  return parsed as Envelope<T, unknown>;
}

/**
 * Single-flight refresh attempt. Concurrent 401s end up sharing one
 * outstanding rotation request — the second caller awaits the same
 * promise instead of racing the BE's rotation lock.
 */
let pendingRefresh: Promise<boolean> | null = null;

async function attemptRefresh(): Promise<boolean> {
  if (pendingRefresh) return pendingRefresh;
  pendingRefresh = (async () => {
    try {
      const res = await fetch(buildUrl('/api/auth/refresh', undefined), {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      pendingRefresh = null;
    }
  })();
  return pendingRefresh;
}
