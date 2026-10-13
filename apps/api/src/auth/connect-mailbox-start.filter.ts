import { Catch, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { parseBillingReturnTo, type ApiError } from '@declutrmail/shared/contracts';

import { AllExceptionsFilter } from '../common/all-exceptions.filter.js';

export type ConnectMailboxStartResult =
  | 'target_invalid'
  | 'inbox_limit'
  | 'pass_second_account'
  | 'session_retry'
  | 'rate_limited'
  | 'failed';

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
  protected override respond(res: Response, status: number, error?: ApiError): void {
    if (res.headersSent) return;

    const result =
      error?.details?.reason === 'pass'
        ? 'pass_second_account'
        : (connectMailboxStartResult(status) ?? 'failed');
    const webBase = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

    const destination = parseBillingReturnTo(res.req?.query?.billingReturnTo);
    const query = new URLSearchParams({
      ...(destination ? { resumeScan: '1', returnTo: destination } : {}),
      connect_start_result: result,
    });
    res.redirect(
      HttpStatus.FOUND,
      destination ? `${webBase}/onboarding?${query}` : `${webBase}/settings?${query}#mailboxes`,
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
