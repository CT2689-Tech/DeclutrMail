import type { NextFunction, Request, Response } from 'express';

/**
 * Emit one structured `http.request` line per API call (D150, D159).
 *
 * Why. pg_stat_statements tells us which SQL is slow; it cannot tell us
 * which HTTP route waited on it. Sentry is web-only. Without a per-route
 * duration we keep guessing whether a slow `/api/senders/summary` is the
 * query, the lock, or the JS waterfall.
 *
 * MIDDLEWARE, NOT AN INTERCEPTOR, and that is the whole design.
 * NestJS runs guards BEFORE interceptors, so an interceptor's timer
 * starts after `JwtGuard` and `CurrentMailboxGuard` have already made
 * their DB round trips, and a guard REJECTION never reaches the
 * interceptor at all. That would have made this blind to exactly the
 * traffic it exists to explain: every 401, every 409
 * (`NO_ACTIVE_MAILBOX` / `SELECT_MAILBOX` — the 409-storm class
 * CLAUDE.md §8 names as a repeat offender), and every unmatched 404.
 * Middleware runs first, so the duration includes guard work and every
 * rejected request is counted.
 *
 * `res.on('finish')` also fixes two things `tap({next})` could not: a
 * `StreamableFile` response (account export, activity CSV) is measured
 * to the end of the transfer rather than to the controller's return, and
 * `res.on('close')` catches a client that disconnects mid-flight — which
 * the web app now does deliberately when a server prefetch passes its
 * deadline.
 *
 * Privacy (D7): method + route TEMPLATE + status + duration + cid.
 * Never the raw URL — query strings and path params carry sender emails.
 * `req.route` is populated by the time the response finishes, so the
 * template comes from Express's own matched route, not from string
 * assembly.
 */
export function requestTimingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  let emitted = false;

  const emit = (): void => {
    // 'finish' and 'close' can both fire; the first one wins.
    if (emitted) return;
    emitted = true;

    const route = routeTemplate(req);
    // Probes are skipped here rather than earlier so the check costs
    // nothing on the request path — Cloud Run hits them continuously and
    // they would drown the log.
    if (route === 'GET /api/healthz' || route === 'GET /api/readyz') return;

    console.log(
      JSON.stringify({
        level: 'info',
        kind: 'http.request',
        method: req.method,
        route,
        status: res.statusCode,
        // `durationMs`, not `duration_ms`: every other structured log in
        // this repo spells it this way, and a latency query that cannot
        // span HTTP and worker spans is worth less than no query.
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
        // `cid`, matching `AllExceptionsFilter` — otherwise the timing
        // line and the exception line for the same request carry the
        // same uuid under two different keys and will not join.
        cid: req.correlationId ?? null,
      }),
    );
  };

  res.on('finish', emit);
  res.on('close', emit);
  next();
}

/**
 * The matched route template, or a closed fallback.
 *
 * Reads Express's own `req.route.path` — the same source
 * `AllExceptionsFilter.requestOperation` uses — so the two log streams
 * spell a route identically and can be joined. `unmatched` is a closed
 * value: an unrouted request must never log its raw URL.
 */
function routeTemplate(req: Request): string {
  const path = req.route && typeof req.route.path === 'string' ? req.route.path : null;
  if (path === null) {
    return `${req.method} unmatched`;
  }
  const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
  return `${req.method} ${base}${path}`;
}
