import { randomUUID } from 'node:crypto';

import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  type ApiError,
  type ErrorSeverityTier,
  classifyHttpError,
  deriveDisplayId,
} from '@declutrmail/shared/contracts';

import { AppException } from './app-exception.js';

/**
 * AllExceptionsFilter — maps every thrown exception to the D168 error
 * envelope: `{ error: { code, message, correlationId, traceId,
 * displayId, retryable, severityTier } }`.
 *
 * Classification (D169):
 *   - `AppException` carries its own `code` / `retryable` / `severityTier`
 *     (use it for domain codes and D170 critical-trust banners).
 *   - Plain `HttpException` subclasses (BadRequestException, etc.) surface
 *     their status + a safe message; `retryable` + `severityTier` are
 *     derived from the status via `classifyHttpError`.
 *   - Everything else is a 500 with a generic message.
 *
 * The correlation identifiers are read off `req` (set by
 * `correlationMiddleware`). They are regenerated defensively here if a
 * request ever reaches the filter without them, so the envelope is
 * never missing its join key.
 *
 * Privacy (D7, D228): a raw exception message, stack, request body, or
 * the OAuth `code` query param must never reach the response. Logging is
 * deliberately minimal: `<METHOD> <path> -> <status> <ErrorClassName>
 * cid=<correlationId>`. The exception message and request params are NOT
 * logged — they can carry the OAuth `code` or token-exchange detail.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();

    const correlationId = req.correlationId ?? randomUUID();
    const traceId = req.traceId ?? null;
    const displayId = req.displayId ?? deriveDisplayId(correlationId);

    const { status, ...rest } = this.resolve(exception);

    this.logger.error(
      `${req.method} ${req.path} -> ${status} ${this.errorName(exception)} cid=${correlationId}`,
    );

    const error: ApiError = { ...rest, correlationId, traceId, displayId };
    res.status(status).json({ error });
  }

  /**
   * HTTP status + the status-independent envelope fields (code, message,
   * retryable, severityTier). The correlation identifiers are merged in
   * by `catch` since they come from the request, not the exception.
   */
  private resolve(exception: unknown): {
    status: number;
    code: string;
    message: string;
    retryable: boolean;
    severityTier: ErrorSeverityTier;
  } {
    if (exception instanceof AppException) {
      const status = exception.getStatus();
      return {
        status,
        code: exception.code,
        message: this.safeHttpMessage(exception),
        retryable: exception.retryable,
        severityTier: exception.severityTier,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        code: this.codeForStatus(status),
        message: this.safeHttpMessage(exception),
        ...classifyHttpError(status),
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      ...classifyHttpError(HttpStatus.INTERNAL_SERVER_ERROR),
    };
  }

  /**
   * The public message for an HttpException. Nest stores it on the
   * response body; for client-error (4xx) statuses it is safe to
   * surface, for 5xx it is replaced with a generic string so config
   * detail never leaks.
   */
  private safeHttpMessage(exception: HttpException): string {
    if (exception.getStatus() >= HttpStatus.INTERNAL_SERVER_ERROR) {
      return 'Internal server error';
    }
    const body = exception.getResponse();
    if (typeof body === 'string') {
      return body;
    }
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
    if (Array.isArray(message)) {
      return message.join(', ');
    }
    return exception.message;
  }

  /** A stable envelope `code` derived from the HTTP status. */
  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'BAD_REQUEST';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMITED';
      default:
        return status >= HttpStatus.INTERNAL_SERVER_ERROR ? 'INTERNAL_ERROR' : 'ERROR';
    }
  }

  /** Class name of the thrown value, for the log line only. */
  private errorName(exception: unknown): string {
    return exception instanceof Error ? exception.constructor.name : typeof exception;
  }
}
