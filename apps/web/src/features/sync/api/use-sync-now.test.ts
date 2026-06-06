import { describe, expect, it } from 'vitest';

import { SyncNowError, translateSyncNowError } from './use-sync-now';

/**
 * Boundary unit tests for `translateSyncNowError` (D38 prod-ready
 * pass). The helper turns the D202 wire error shape into the closed
 * `SyncNowErrorCode` union the mutation hook + toast routing depend
 * on. Each branch in the FE error handling is paired with one of
 * these cases — keeping the test surface narrow lets us refactor the
 * mutation flow without recompiling the whole table.
 */
describe('translateSyncNowError', () => {
  it('maps a 409 with SYNC_NOT_READY body to SYNC_NOT_READY', () => {
    const err = {
      status: 409,
      body: { error: { code: 'SYNC_NOT_READY', message: 'Not ready yet.' } },
    };
    const out = translateSyncNowError(err);
    expect(out).toBeInstanceOf(SyncNowError);
    expect(out.code).toBe('SYNC_NOT_READY');
  });

  it('maps a 400 with SYNC_NOT_READY body to SYNC_NOT_READY (Nest BadRequestException path)', () => {
    // The controller throws `BadRequestException` which serialises as
    // 400. The wire code is what discriminates SYNC_NOT_READY vs a
    // generic 400. This guards the FE against a future Nest behavior
    // change that flips between 400 and 409 — we don't want the
    // discrimination to leak the HTTP status mapping.
    const err = {
      status: 400,
      body: { error: { code: 'SYNC_NOT_READY', message: 'Not ready yet.' } },
    };
    expect(translateSyncNowError(err).code).toBe('SYNC_NOT_READY');
  });

  it('maps a 429 with a Retry-After header into RATE_LIMITED + retryAfterSec', () => {
    const headers = new Headers({ 'retry-after': '42' });
    const err = { status: 429, body: { error: { code: 'RATE_LIMITED' } }, headers };
    const out = translateSyncNowError(err);
    expect(out.code).toBe('RATE_LIMITED');
    expect(out.retryAfterSec).toBe(42);
  });

  it('maps a 429 with no Retry-After header into RATE_LIMITED + null retryAfterSec', () => {
    const err = { status: 429, body: { error: { code: 'RATE_LIMITED' } } };
    const out = translateSyncNowError(err);
    expect(out.code).toBe('RATE_LIMITED');
    expect(out.retryAfterSec).toBeNull();
  });

  it('maps a 401 to NO_ACTIVE_MAILBOX', () => {
    const err = { status: 401, body: { error: { code: 'NO_ACTIVE_MAILBOX' } } };
    expect(translateSyncNowError(err).code).toBe('NO_ACTIVE_MAILBOX');
  });

  it('falls through to UNKNOWN for unrecognised shapes', () => {
    const err = new Error('network down');
    expect(translateSyncNowError(err).code).toBe('UNKNOWN');
  });

  it('passes a pre-translated SyncNowError through unchanged', () => {
    const original = new SyncNowError('RATE_LIMITED', 'already translated', 30);
    expect(translateSyncNowError(original)).toBe(original);
  });
});
