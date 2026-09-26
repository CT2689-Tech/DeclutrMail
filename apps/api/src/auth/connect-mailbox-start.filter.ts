import { Catch, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

import { AllExceptionsFilter } from '../common/all-exceptions.filter.js';

export type ConnectMailboxStartResult =
  'target_invalid' | 'inbox_limit' | 'session_retry' | 'rate_limited' | 'failed';

/**
 * `/connect-mailbox/start` is deliberately a full-page browser navigation.
 * Convert every failure into a closed, privacy-safe app return so an
 * expired target, a plan gate or an outage never strands someone on API
 * JSON (D108).
 *
 * Extends `AllExceptionsFilter`, as `IconErrorFilter` does: classification,
 * the structured error log and the 5xx Sentry capture are unchanged. Only
 * the bytes on the wire change. Anything without an expected mapping is the
 * closed `failed` result.
 */
@Catch()
export class ConnectMailboxStartFilter extends AllExceptionsFilter {
  protected override respond(res: Response, status: number): void {
    if (res.headersSent) return;

    const result = connectMailboxStartResult(status) ?? 'failed';
    const webBase = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

    res.redirect(HttpStatus.FOUND, `${webBase}/settings?connect_start_result=${result}#mailboxes`);
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
