import { HttpException, HttpStatus } from '@nestjs/common';

import type { ErrorSeverityTier } from '@declutrmail/shared/contracts';

/**
 * AppException (D168, D169) — an `HttpException` that carries the D168
 * envelope's `code`, plus the D169 `severityTier` and `retryable`
 * classification explicitly, rather than letting `AllExceptionsFilter`
 * infer them from the HTTP status.
 *
 * Reach for this (over a plain `BadRequestException` etc.) when:
 *   - the error needs a domain-specific `code` the FE branches on
 *     (e.g. `SELECT_MAILBOX`, `OAUTH_REVOKED`), OR
 *   - the failure is a D170 critical-trust scenario that must surface
 *     as a banner, i.e. `severityTier: 'critical_trust'`.
 *
 * Plain Nest `HttpException`s keep working unchanged — the filter
 * derives their `code`/`retryable`/`severityTier` from the status.
 */
export interface AppExceptionOptions {
  /** Stable machine-readable code for the D168 envelope. */
  code: string;
  /** Human-readable message. Surfaced as-is for 4xx; genericized for 5xx. */
  message: string;
  /** HTTP status. Defaults to 500. */
  status?: HttpStatus;
  /** Whether retrying the identical request might succeed. Defaults to false. */
  retryable?: boolean;
  /** D169 tier. Defaults to `inline_recoverable`. Set `critical_trust` for D170. */
  severityTier?: ErrorSeverityTier;
}

export class AppException extends HttpException {
  readonly code: string;
  readonly retryable: boolean;
  readonly severityTier: ErrorSeverityTier;

  constructor(opts: AppExceptionOptions) {
    super(opts.message, opts.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    this.code = opts.code;
    this.retryable = opts.retryable ?? false;
    this.severityTier = opts.severityTier ?? 'inline_recoverable';
  }
}
