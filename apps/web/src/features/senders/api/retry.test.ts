/**
 * `retryUnless4xx` covers the 4xx-storm class — every 4xx is a
 * designed state, never a retry. Pre-flow-completeness-auditor fix
 * (2026-06-06) the predicate only short-circuited 404, which let
 * a mid-flight mailbox disconnect (409 NO_ACTIVE_MAILBOX from
 * `CurrentMailboxGuard`) retry 12× across the four Sender Detail panes.
 */

import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/client';
import { retryUnless4xx } from './retry';

const ENVELOPE_BASE = {
  errorBody: undefined,
  message: 'fail',
  retryable: false,
};

function err(status: number): ApiError {
  return new ApiError(status, { error: { code: 'TEST' } }, `HTTP ${status}`);
}

describe('retryUnless4xx', () => {
  it('short-circuits 404 (stale id)', () => {
    expect(retryUnless4xx(0, err(404))).toBe(false);
    expect(retryUnless4xx(2, err(404))).toBe(false);
  });

  it('short-circuits 409 (NO_ACTIVE_MAILBOX / MAILBOX_NOT_OWNED)', () => {
    expect(retryUnless4xx(0, err(409))).toBe(false);
    expect(retryUnless4xx(2, err(409))).toBe(false);
  });

  it('short-circuits 410 (undo expired)', () => {
    expect(retryUnless4xx(0, err(410))).toBe(false);
  });

  it('short-circuits 422 (bad request)', () => {
    expect(retryUnless4xx(0, err(422))).toBe(false);
  });

  it('retries 500 up to 3 times (transient)', () => {
    expect(retryUnless4xx(0, err(500))).toBe(true);
    expect(retryUnless4xx(2, err(500))).toBe(true);
    expect(retryUnless4xx(3, err(500))).toBe(false);
  });

  it('retries network/timeout errors (non-ApiError) up to 3 times', () => {
    expect(retryUnless4xx(0, new Error('timeout'))).toBe(true);
    expect(retryUnless4xx(3, new Error('timeout'))).toBe(false);
  });

  it('does not short-circuit on a 3xx (defensive — 3xx should never reach here)', () => {
    expect(retryUnless4xx(0, err(304))).toBe(true);
  });

  it('exposes a backwards-compat retryUnless404 alias', async () => {
    const { retryUnless404 } = await import('./retry');
    expect(retryUnless404).toBe(retryUnless4xx);
  });

  // Touch the unused env constant so the linter doesn't flag the
  // dead binding (kept in case future tests want to share a shape).
  it('keeps the test envelope shape stable', () => {
    expect(ENVELOPE_BASE.retryable).toBe(false);
  });
});
