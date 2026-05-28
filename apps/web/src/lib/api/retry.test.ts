/**
 * Tests for `retryTransientOnly` — the predicate that stops mailbox-
 * scoped reads from retrying client errors. A 409 (SELECT_MAILBOX /
 * MAILBOX_NOT_OWNED) retried 3× is what amplified a single unresolved-
 * mailbox state into a 409 storm (logs, 2026-05-27).
 */

import { describe, expect, it } from 'vitest';
import { ApiError } from './client';
import { retryTransientOnly } from './retry';

describe('retryTransientOnly', () => {
  it('does NOT retry a 409 (unresolved mailbox is not transient)', () => {
    expect(retryTransientOnly(0, new ApiError(409, {}, 'conflict'))).toBe(false);
  });

  it('does NOT retry a 404', () => {
    expect(retryTransientOnly(0, new ApiError(404, {}, 'not found'))).toBe(false);
  });

  it('retries a 500 up to 3 times then stops', () => {
    const err = new ApiError(500, {}, 'server');
    expect(retryTransientOnly(0, err)).toBe(true);
    expect(retryTransientOnly(2, err)).toBe(true);
    expect(retryTransientOnly(3, err)).toBe(false);
  });

  it('retries non-ApiError (network) failures', () => {
    expect(retryTransientOnly(0, new Error('network down'))).toBe(true);
  });
});
