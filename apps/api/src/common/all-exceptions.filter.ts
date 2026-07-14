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
  type ErrorCode,
  type ErrorSeverityTier,
  ERROR_CODES,
  classifyHttpError,
  deriveDisplayId,
  isErrorCode,
} from '@declutrmail/shared/contracts';

import { AppException } from './app-exception.js';

const SAFE_RUNTIME_ERROR_CODES: ReadonlySet<string> = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
]);

const SAFE_EXCEPTION_ERROR_KINDS: ReadonlySet<string> = new Set([
  'AggregateError',
  'AppException',
  'BadGatewayException',
  'BadRequestException',
  'ConflictException',
  'Error',
  'ForbiddenException',
  'GatewayTimeoutException',
  'GoneException',
  'HttpException',
  'InternalServerErrorException',
  'MethodNotAllowedException',
  'NotAcceptableException',
  'NotFoundException',
  'NotImplementedException',
  'PayloadTooLargeException',
  'RangeError',
  'RequestTimeoutException',
  'ServiceUnavailableException',
  'SyntaxError',
  'TypeError',
  'UnauthorizedException',
  'UnprocessableEntityException',
  'UnsupportedMediaTypeException',
]);

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
 * Privacy (D7, D228): a raw request path can contain capability tokens
 * (`/undo/:token`) or attacker-controlled unmatched text. Operational
 * telemetry therefore uses only the application-owned route template;
 * an unresolved route is the closed value `unmatched`.
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
    const operation = this.requestOperation(req);

    const { status, ...rest } = this.resolve(exception);

    this.logger.error(
      `${operation.method} ${operation.route} -> ${status} ${this.errorName(exception)} cid=${correlationId}`,
    );

    // 5xx-only diagnostics are deliberately structural until the server
    // Sentry bootstrap has a deny-by-default event sanitizer. Exception
    // messages, response payloads and original stacks can all contain
    // provider ids, OAuth codes or capability URLs, so none cross this
    // operational boundary.
    if (status >= 500 && exception instanceof Error) {
      const errObj = exception as Error & {
        response?: { status?: number; data?: unknown };
        code?: string | number;
      };
      const errorKind = this.errorName(exception);
      const exceptionCode = this.safeExceptionCode(errObj.code);
      const upstreamStatus = this.safeNumericStatus(errObj.response?.status);
      const detail = {
        kind: 'exception.5xx',
        cid: correlationId,
        route: operation.route,
        method: operation.method,
        errorKind,
        ...(exceptionCode !== null ? { code: exceptionCode } : {}),
        ...(upstreamStatus !== null ? { responseStatus: upstreamStatus } : {}),
      };
      console.error(JSON.stringify(detail));
      // Fire-and-forget Sentry capture. The dynamic import keeps the
      // @sentry/node bundle out of the no-DSN path. Errors in capture
      // itself are swallowed — we never want a failing alert pipeline
      // to escalate into another 500 on the response path.
      if (process.env.SENTRY_DSN) {
        void import('@sentry/node')
          .then((Sentry) => {
            Sentry.withScope((scope) => {
              scope.setTags({
                cid: correlationId,
                method: operation.method,
                route: operation.route,
                response_status: String(status),
              });
              if (upstreamStatus !== null) {
                scope.setTag('upstream_status', String(upstreamStatus));
              }
              scope.setFingerprint([
                'server-exception',
                operation.method,
                operation.route,
                errorKind,
                String(status),
              ]);
              const safeException = new Error('Server exception');
              safeException.name = errorKind;
              Sentry.captureException(safeException);
            });
          })
          .catch(() => {
            // Sentry transport failed — nothing more we can do.
          });
      }
    }

    const error: ApiError = { ...rest, correlationId, traceId, displayId };
    res.status(status).json({ error });
  }

  /** Application-owned route identity; never falls back to the raw URL. */
  private requestOperation(req: Request): { method: string; route: string } {
    const method = /^(DELETE|GET|HEAD|OPTIONS|PATCH|POST|PUT)$/.test(req.method)
      ? req.method
      : 'OTHER';
    const routePath: unknown = req.route?.path;
    if (
      typeof routePath !== 'string' ||
      routePath.length === 0 ||
      routePath.length > 180 ||
      !/^\/(?:[a-z0-9._~-]+|:[a-z][a-z0-9_]*)(?:\/(?:[a-z0-9._~-]+|:[a-z][a-z0-9_]*))*$/i.test(
        routePath,
      )
    ) {
      return { method, route: 'unmatched' };
    }
    return { method, route: routePath };
  }

  /** Registry/allowlist projection; arbitrary SDK/user strings drop. */
  private safeExceptionCode(code: unknown): string | null {
    if (typeof code === 'string' && (isErrorCode(code) || SAFE_RUNTIME_ERROR_CODES.has(code))) {
      return code;
    }
    return null;
  }

  private safeNumericStatus(status: unknown): number | null {
    return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
      ? status
      : null;
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
    details?: Record<string, string | number | boolean | null>;
  } {
    if (exception instanceof AppException) {
      const status = exception.getStatus();
      return {
        status,
        code: exception.code,
        message: this.safeHttpMessage(exception),
        retryable: exception.retryable,
        severityTier: exception.severityTier,
        // Scalar machine-readable context (e.g. FREE_CAP_REACHED's
        // remaining/limit/used counters). Only AppException carries it.
        ...(exception.details ? { details: exception.details } : {}),
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // A throw can carry a registered domain code in its response body
      // (e.g. `new ConflictException({ code: 'NO_ACTIVE_MAILBOX', ... })`).
      // Preserve it + its registry tier/retryable, so the domain code
      // reaches the client instead of being flattened to the status code.
      const bodyCode = this.registeredBodyCode(exception);
      if (bodyCode) {
        const spec = ERROR_CODES[bodyCode];
        return {
          status,
          code: bodyCode,
          message: this.safeHttpMessage(exception),
          retryable: spec.retryable,
          severityTier: spec.severityTier,
        };
      }
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

  /**
   * Extract a registered `ErrorCode` from an HttpException's response
   * body, if it carries one (e.g. `throw new ConflictException({ code,
   * message })`). Returns null when the body has no code or an
   * unregistered one — the caller then falls back to the status-derived
   * code, so an unknown string can never leak through as a "code".
   */
  private registeredBodyCode(exception: HttpException): ErrorCode | null {
    const body = exception.getResponse();
    if (body && typeof body === 'object' && 'code' in body) {
      const code = (body as { code?: unknown }).code;
      if (isErrorCode(code)) {
        return code;
      }
    }
    return null;
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

  /** Exact source-owned class allowlist; every unknown kind collapses to `Error`. */
  private errorName(exception: unknown): string {
    if (!(exception instanceof Error)) {
      return 'NonErrorThrow';
    }
    try {
      // Read from the prototype, not `exception.constructor`: a hostile
      // Error can install an own throwing getter on that property.
      const prototype = Object.getPrototypeOf(exception) as { constructor?: unknown } | null;
      const constructor = prototype?.constructor;
      const name =
        typeof constructor === 'function' && typeof constructor.name === 'string'
          ? constructor.name
          : '';
      return SAFE_EXCEPTION_ERROR_KINDS.has(name) ? name : 'Error';
    } catch {
      return 'Error';
    }
  }
}
