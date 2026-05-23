/**
 * Lightweight `fetch` stub for tests.
 *
 * We deliberately don't install MSW (`msw`) because it adds ~3 MB of
 * deps and a separate ServiceWorker setup just to intercept fetches
 * we already control. The footprint we need is small: take an
 * incoming `Request`, match it against a registered handler, and
 * return a `Response`. This module is ~70 lines and does exactly that.
 *
 * Usage:
 *
 *   import { installFetchStub, resetFetchStub } from '@/test/fetch-stub';
 *
 *   installFetchStub([
 *     { method: 'GET', path: '/api/senders',
 *       respond: () => ok({ data: [...], meta: {...} }) },
 *     { method: 'GET', path: /\/api\/senders\/[^/]+/,
 *       respond: () => notFound('sender_not_found') },
 *   ]);
 *
 * The setup file (`src/test/setup.ts`) calls `resetFetchStub()` after
 * every test so handlers don't leak.
 */

export interface FetchStubHandler {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Path string (exact match) or RegExp (tested against URL pathname). */
  path: string | RegExp;
  /**
   * Build the response. Receives the `Request` so the handler can
   * inspect headers + the query string. The handler MAY return a
   * Promise; the stub awaits.
   */
  respond: (req: Request, url: URL) => Response | Promise<Response>;
}

let installed = false;
let originalFetch: typeof globalThis.fetch | null = null;
let handlers: FetchStubHandler[] = [];

/** Install the stub and register the initial set of handlers. */
export function installFetchStub(initial: FetchStubHandler[] = []) {
  if (!installed) {
    originalFetch = globalThis.fetch;
    installed = true;
  }
  handlers = [...initial];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    // Pathname compare uses a fallback origin so path-only URLs parse
    // — the API client falls back to '' when NEXT_PUBLIC_API_URL isn't
    // set, which gives us bare paths to match against.
    const url = new URL(req.url, 'http://localhost');
    const handler = handlers.find((h) => {
      if (h.method !== req.method) return false;
      if (typeof h.path === 'string') return h.path === url.pathname;
      return h.path.test(url.pathname);
    });
    if (!handler) {
      return new Response(
        JSON.stringify({ error: 'no_handler', url: req.url, method: req.method }),
        { status: 599, headers: { 'content-type': 'application/json' } },
      );
    }
    return handler.respond(req, url);
  }) as typeof globalThis.fetch;
}

/** Append handlers without resetting existing ones. */
export function addFetchHandlers(more: FetchStubHandler[]) {
  if (!installed) {
    installFetchStub(more);
    return;
  }
  handlers.push(...more);
}

/** Reset handlers; restore original `fetch` if it was patched. */
export function resetFetchStub() {
  handlers = [];
  if (installed && originalFetch) {
    globalThis.fetch = originalFetch;
  }
  installed = false;
  originalFetch = null;
}

// ── Response builders ───────────────────────────────────────────────

/** 200 JSON response. */
export function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** 404 with a structured error body. */
export function jsonNotFound(code: string = 'not_found'): Response {
  return new Response(JSON.stringify({ error: { code } }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}

/** 500 with a structured error body. */
export function jsonServerError(message: string = 'internal_error'): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status: 500,
    headers: { 'content-type': 'application/json' },
  });
}
