import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * AllExceptionsFilter — maps every thrown exception to the D202 error
 * envelope: `{ error: { code, message } }`.
 *
 * `HttpException` subclasses (BadRequestException, etc.) surface their
 * status + a safe message. Everything else is treated as a 500 with a
 * generic message — a raw exception message, stack, request body, or
 * the OAuth `code` query param must never reach the response.
 *
 * Logging is deliberately minimal: `<METHOD> <path> -> <status>
 * <ErrorClassName>`. The exception message and request params are NOT
 * logged — they can carry the OAuth `code` or token-exchange detail.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();

    const { status, code, message } = this.resolve(exception);

    this.logger.error(`${req.method} ${req.path} -> ${status} ${this.errorName(exception)}`);

    res.status(status).json({ error: { code, message } });
  }

  /** HTTP status + a safe envelope code/message for the response. */
  private resolve(exception: unknown): { status: number; code: string; message: string } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        code: this.codeForStatus(status),
        message: this.safeHttpMessage(exception),
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
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
