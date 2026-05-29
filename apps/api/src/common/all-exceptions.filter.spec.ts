import { BadRequestException, ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { AppException } from './app-exception.js';

/**
 * Tests for the D168 error envelope + D169 severity classification.
 *
 * Locks in: the full envelope shape, the 429 → 'RATE_LIMITED' mapping
 * the rate-limit interceptor depends on (D156), status-derived
 * retryable/severityTier (D169), AppException passthrough (incl. D170
 * critical_trust), 5xx message genericization (D7), and the defensive
 * correlationId fallback when the middleware did not run.
 */
function invoke(
  filter: AllExceptionsFilter,
  exception: unknown,
  req: Record<string, unknown> = { method: 'GET', path: '/api/test' },
): { status: number; body: { error: Record<string, unknown> } } {
  const statusFn = vi.fn().mockReturnThis();
  const jsonFn = vi.fn();
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status: statusFn, json: jsonFn }),
      getRequest: () => req,
    }),
  };

  filter.catch(exception, host as unknown as Parameters<AllExceptionsFilter['catch']>[1]);

  return {
    status: statusFn.mock.calls[0]?.[0] as number,
    body: jsonFn.mock.calls[0]?.[0] as { error: Record<string, unknown> },
  };
}

const REQ_WITH_CORRELATION = {
  method: 'POST',
  path: '/api/actions',
  correlationId: '7f2a91d4-0000-4000-8000-000000000000',
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  displayId: 'DM-7F2A91',
};

describe('AllExceptionsFilter — D168 envelope + D169 tiers', () => {
  it('maps HTTP 429 to RATE_LIMITED, retryable, inline_recoverable', () => {
    const { status, body } = invoke(
      new AllExceptionsFilter(),
      new HttpException('Too many requests.', HttpStatus.TOO_MANY_REQUESTS),
      REQ_WITH_CORRELATION,
    );

    expect(status).toBe(429);
    expect(body.error).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Too many requests.',
      correlationId: '7f2a91d4-0000-4000-8000-000000000000',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      displayId: 'DM-7F2A91',
      retryable: true,
      severityTier: 'inline_recoverable',
    });
  });

  it('classifies a 4xx client error as non-retryable', () => {
    const { status, body } = invoke(
      new AllExceptionsFilter(),
      new BadRequestException('bad input'),
      REQ_WITH_CORRELATION,
    );

    expect(status).toBe(400);
    expect(body.error).toMatchObject({
      code: 'BAD_REQUEST',
      retryable: false,
      severityTier: 'inline_recoverable',
    });
  });

  it('genericizes 5xx messages and marks them retryable (D7)', () => {
    const { status, body } = invoke(
      new AllExceptionsFilter(),
      new HttpException('db dsn leaked', HttpStatus.INTERNAL_SERVER_ERROR),
      REQ_WITH_CORRELATION,
    );

    expect(status).toBe(500);
    expect(body.error.message).toBe('Internal server error');
    expect(body.error.retryable).toBe(true);
  });

  it('passes through AppException code/retryable/severityTier (D170)', () => {
    const { status, body } = invoke(
      new AllExceptionsFilter(),
      new AppException({
        code: 'OAUTH_REVOKED',
        message: 'Reconnect your Gmail account.',
        status: HttpStatus.CONFLICT,
        retryable: false,
        severityTier: 'critical_trust',
      }),
      REQ_WITH_CORRELATION,
    );

    expect(status).toBe(409);
    expect(body.error).toMatchObject({
      code: 'OAUTH_REVOKED',
      message: 'Reconnect your Gmail account.',
      severityTier: 'critical_trust',
      retryable: false,
    });
  });

  it('preserves a registered domain code from the exception body (ADR-0014)', () => {
    // The mailbox guard throws `new ConflictException({ code, message })`.
    // The filter must surface that domain code, not flatten it to CONFLICT.
    const { status, body } = invoke(
      new AllExceptionsFilter(),
      new ConflictException({
        code: 'NO_ACTIVE_MAILBOX',
        message: 'No active Gmail account is connected. Connect one to continue.',
      }),
      REQ_WITH_CORRELATION,
    );

    expect(status).toBe(409);
    expect(body.error).toMatchObject({
      code: 'NO_ACTIVE_MAILBOX',
      message: 'No active Gmail account is connected. Connect one to continue.',
      severityTier: 'inline_recoverable',
      retryable: false,
    });
  });

  it('falls back to the status code when the body code is unregistered', () => {
    const { body } = invoke(
      new AllExceptionsFilter(),
      new ConflictException({ code: 'NOT_A_REAL_CODE', message: 'nope' }),
      REQ_WITH_CORRELATION,
    );

    expect(body.error.code).toBe('CONFLICT');
  });

  it('treats an unknown thrown value as a 500 INTERNAL_ERROR', () => {
    const { status, body } = invoke(
      new AllExceptionsFilter(),
      new Error('boom'),
      REQ_WITH_CORRELATION,
    );

    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Internal server error');
  });

  it('defensively fills correlation ids when the middleware did not run', () => {
    const { body } = invoke(new AllExceptionsFilter(), new BadRequestException('x'));

    expect(typeof body.error.correlationId).toBe('string');
    expect((body.error.correlationId as string).length).toBeGreaterThan(0);
    expect(body.error.displayId).toMatch(/^DM-[0-9A-F]{6}$/);
    expect(body.error.traceId).toBeNull();
  });
});
