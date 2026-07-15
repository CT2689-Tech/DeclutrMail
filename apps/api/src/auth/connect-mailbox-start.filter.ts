import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

import { AllExceptionsFilter } from '../common/all-exceptions.filter.js';

export type ConnectMailboxStartResult =
  'target_invalid' | 'inbox_limit' | 'session_retry' | 'rate_limited';

/**
 * `/connect-mailbox/start` is deliberately a full-page browser navigation.
 * Convert its expected HTTP failures into a closed, privacy-safe app return
 * so an expired target or plan gate never strands someone on API JSON.
 *
 * Non-HTTP runtime failures still reach the global exception filter directly.
 * Unexpected HTTP statuses are explicitly delegated to the same filter so 5xx
 * correlation and Sentry diagnostics are preserved.
 */
@Catch(HttpException)
export class ConnectMailboxStartFilter implements ExceptionFilter<HttpException> {
  private readonly fallback = new AllExceptionsFilter();

  catch(exception: HttpException, host: ArgumentsHost): void {
    const result = connectMailboxStartResult(exception.getStatus());
    if (result === null) {
      this.fallback.catch(exception, host);
      return;
    }

    const response = host.switchToHttp().getResponse<Response>();
    const webBase = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

    response.redirect(
      HttpStatus.FOUND,
      `${webBase}/settings?connect_start_result=${result}#mailboxes`,
    );
  }
}

export function connectMailboxStartResult(status: number): ConnectMailboxStartResult | null {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'target_invalid';
    case HttpStatus.PAYMENT_REQUIRED:
      return 'inbox_limit';
    case HttpStatus.UNAUTHORIZED:
      return 'session_retry';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'rate_limited';
    default:
      return null;
  }
}
