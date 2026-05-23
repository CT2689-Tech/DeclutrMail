import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AllExceptionsFilter } from './all-exceptions.filter.js';

/**
 * Targeted tests for the rate-limit envelope mapping (D156 + D168).
 *
 * The filter is already covered implicitly by other features; this file
 * locks in the 429 → 'RATE_LIMITED' envelope code so a future filter
 * edit can't silently regress the contract the rate-limit interceptor
 * depends on.
 */
describe('AllExceptionsFilter — 429 envelope (D156)', () => {
  it('maps HTTP 429 to error.code = RATE_LIMITED', () => {
    const filter = new AllExceptionsFilter();
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status, json }),
        getRequest: () => ({ method: 'GET', path: '/api/test' }),
      }),
    };

    filter.catch(
      new HttpException('Too many requests.', HttpStatus.TOO_MANY_REQUESTS),
      host as unknown as Parameters<AllExceptionsFilter['catch']>[1],
    );

    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'RATE_LIMITED', message: 'Too many requests.' },
    });
  });
});
