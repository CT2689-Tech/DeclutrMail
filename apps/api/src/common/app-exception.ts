import { HttpException, type HttpStatus } from '@nestjs/common';

import { ERROR_CODES, type ErrorCode, type ErrorSeverityTier } from '@declutrmail/shared/contracts';

/**
 * AppException (D168, D169) — an `HttpException` that carries a registered
 * `ErrorCode` (ADR-0014) plus the D169 `severityTier` and `retryable`
 * classification explicitly, rather than letting `AllExceptionsFilter`
 * infer them from the HTTP status.
 *
 * Reach for this (over a plain `BadRequestException` etc.) when the error
 * is a named domain condition the FE branches on — especially a D170
 * critical-trust scenario that must surface as a banner
 * (`severityTier: 'critical_trust'`).
 *
 * `status`, `message`, `severityTier`, and `retryable` all default from
 * the registry entry for `code`; pass any of them to override. Plain Nest
 * `HttpException`s keep working unchanged — the filter resolves their code
 * from the registry (if the thrown body carries one) or the HTTP status.
 */
export interface AppExceptionOptions {
  /** A registered error code (ADR-0014). */
  code: ErrorCode;
  /** Override the registry's default user-facing message. */
  message?: string;
  /** Override the registry's default HTTP status. */
  status?: HttpStatus;
  /** Override the registry's default retryability. */
  retryable?: boolean;
  /** Override the registry's default D169 tier. */
  severityTier?: ErrorSeverityTier;
}

export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly severityTier: ErrorSeverityTier;

  constructor(opts: AppExceptionOptions) {
    const spec = ERROR_CODES[opts.code];
    super(opts.message ?? spec.message, opts.status ?? spec.status);
    this.code = opts.code;
    this.retryable = opts.retryable ?? spec.retryable;
    this.severityTier = opts.severityTier ?? spec.severityTier;
  }
}
