import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { deriveDisplayId } from '@declutrmail/shared/contracts';

/**
 * Correlation middleware (D168).
 *
 * Stamps every request with the identifiers the D168 error envelope and
 * the structured logs join on:
 *   - `correlationId` — a per-request uuid. Reuses an inbound
 *     `X-Request-Id` / `X-Correlation-Id` if the caller supplied a
 *     well-formed uuid (so a value set at the edge/load-balancer
 *     threads through), otherwise mints one.
 *   - `traceId` — the W3C trace-context trace-id parsed from an inbound
 *     `traceparent` header, else null. We do not originate a trace
 *     (Sentry tracing is off per D159); we only propagate one if an
 *     upstream started it.
 *   - `displayId` — the short `DM-XXXXXX` support code derived from the
 *     correlationId.
 *
 * The correlationId + displayId are echoed back as response headers so a
 * client (and the network tab) can see them even on a 2xx. The error
 * filter reads the same fields off `req` for the failure path.
 *
 * Privacy (D7): IDs are random/opaque — no body, no user content.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Per-request correlation uuid (D168). Always set by this middleware. */
      correlationId?: string;
      /** W3C trace-id from an upstream `traceparent`, else null (D168). */
      traceId?: string | null;
      /** User-quotable support code derived from `correlationId` (D168). */
      displayId?: string;
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extract the trace-id from a W3C `traceparent` header
 * (`version-traceid-spanid-flags`). Returns null for a missing or
 * malformed header, or the all-zero "invalid" trace-id.
 */
export function parseTraceId(traceparent: string | undefined): string | null {
  if (!traceparent) return null;
  const parts = traceparent.split('-');
  if (parts.length < 3) return null;
  const traceId = parts[1];
  if (!traceId || !/^[0-9a-f]{32}$/i.test(traceId) || /^0{32}$/.test(traceId)) return null;
  return traceId.toLowerCase();
}

/** First non-empty value for a header that may arrive as string | string[]. */
function headerValue(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = headerValue(req.headers['x-request-id'] ?? req.headers['x-correlation-id']);
  const correlationId = inbound && UUID_RE.test(inbound) ? inbound.toLowerCase() : randomUUID();
  const displayId = deriveDisplayId(correlationId);

  req.correlationId = correlationId;
  req.traceId = parseTraceId(headerValue(req.headers['traceparent']));
  req.displayId = displayId;

  res.setHeader('X-Correlation-Id', correlationId);
  res.setHeader('X-Request-Id', correlationId);
  res.setHeader('X-Display-Id', displayId);

  next();
}
