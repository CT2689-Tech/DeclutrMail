// @declutrmail/shared/contracts/error-envelope — D168 error envelope +
// D169 severity tiers.
//
// Companion to `envelope.ts` (D202): success responses carry `{ data,
// meta? }`; every error response carries `{ error: {...} }` in the
// shape below. The NestJS `AllExceptionsFilter` produces it and FE
// TanStack Query hooks consume it, so the wire contract is typed on
// both ends and can't silently drift.
//
// Why each field exists:
//   - `code`           stable machine-readable string; FE branches on it.
//   - `message`        human-readable, safe-to-surface (5xx is genericized).
//   - `correlationId`  per-request uuid; the join key between this
//                      response, the server log line, and Sentry.
//   - `traceId`        W3C trace-context trace-id when an upstream
//                      `traceparent` header was present, else null.
//   - `displayId`      short support code (`DM-7F2A91`) the user can
//                      quote; deterministically derived from
//                      `correlationId` so support can map it back.
//   - `retryable`      whether the same request might succeed if retried
//                      (5xx / 408 / 429); lets the FE decide retry vs. fail.
//   - `severityTier`   D169 — how the FE should react (see below).

/**
 * D169 — the three error severity tiers, named once so BE classifier and
 * FE handling reference one source of truth:
 *
 *   - `silent_transient`  Worker-side only: BullMQ retries with backoff;
 *                         the user never sees it. By definition this tier
 *                         never reaches an HTTP response (the request
 *                         already completed), so the HTTP error filter
 *                         never emits it — it exists here because the
 *                         worker layer (D203) classifies failures with
 *                         the same vocabulary.
 *   - `inline_recoverable` The default for anything that reaches the
 *                         client: surface inline (Activity "needs
 *                         attention" + retry button when `retryable`).
 *   - `critical_trust`    A trust-affecting failure (D170): the FE shows
 *                         a persistent banner (and email if applicable).
 *                         Never inferred from a status code — only set by
 *                         an explicitly-thrown `AppException`.
 */
export type ErrorSeverityTier = 'silent_transient' | 'inline_recoverable' | 'critical_trust';

/** The body of every error response — the value under the `error` key. */
export interface ApiError {
  code: string;
  message: string;
  correlationId: string;
  /** W3C trace-id propagated from an upstream `traceparent`, else null. */
  traceId: string | null;
  /** Short user-quotable support code, e.g. `DM-7F2A91`. */
  displayId: string;
  retryable: boolean;
  severityTier: ErrorSeverityTier;
  /**
   * Optional machine-readable context for the code — scalar fields the
   * FE renders alongside the message (e.g. `FREE_CAP_REACHED` carries
   * `{ remaining: 0, limit: 5, used: 5 }` per D19/D77). Only an
   * `AppException` thrown with explicit `details` populates it; the
   * filter never derives it. Privacy (D7, D228): scalars and counts
   * only — never message content, addresses, or non-allowlisted data.
   */
  details?: Record<string, string | number | boolean | null>;
}

/** The full D168 error envelope as serialized on the wire. */
export interface ErrorEnvelope {
  error: ApiError;
}

/**
 * Derive the user-facing `displayId` from a request `correlationId`.
 *
 * Deterministic so a support agent can reverse the `DM-XXXXXX` a user
 * quotes back to the `correlationId` in the logs. Takes the first six
 * hex characters of the uuid (dashes stripped) and upper-cases them —
 * e.g. correlationId `7f2a91d4-...` → `DM-7F2A91`.
 */
export function deriveDisplayId(correlationId: string): string {
  const hex = correlationId
    .replace(/[^0-9a-fA-F]/g, '')
    .slice(0, 6)
    .toUpperCase();
  return `DM-${hex.padEnd(6, '0')}`;
}

/**
 * Classify a plain HTTP status into the `retryable` + `severityTier`
 * fields. Used by the error filter for any exception that is NOT an
 * `AppException` carrying its own classification.
 *
 * `retryable` is true only for statuses where the identical request
 * might succeed on retry: 5xx (server fault), 408 (request timeout),
 * and 429 (rate limited). Every error that reaches the client is at
 * least `inline_recoverable`; `critical_trust` is reserved for
 * `AppException` (D170) and `silent_transient` for the worker layer.
 */
export function classifyHttpError(status: number): {
  retryable: boolean;
  severityTier: ErrorSeverityTier;
} {
  const retryable = status >= 500 || status === 408 || status === 429;
  return { retryable, severityTier: 'inline_recoverable' };
}
