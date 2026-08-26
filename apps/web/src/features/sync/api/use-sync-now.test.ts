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
    // SyncService raises ConflictException('SYNC_NOT_READY') when the
    // initial-sync gate hasn't flipped to `ready` yet — 409 + this code
    // is the SyncController's natural "come back later" envelope.
    const err = {
      status: 409,
      body: { error: { code: 'SYNC_NOT_READY', message: 'Not ready yet.' } },
    };
    const out = translateSyncNowError(err);
    expect(out).toBeInstanceOf(SyncNowError);
    expect(out.code).toBe('SYNC_NOT_READY');
  });

  it('maps a 409 with NO_ACTIVE_MAILBOX body to NO_ACTIVE_MAILBOX (not SYNC_NOT_READY)', () => {
    // CurrentMailboxGuard throws ConflictException with this code when
    // the workspace has no active mailbox — same 409 as SYNC_NOT_READY
    // but a different recovery path (reconnect, not wait). Discriminating
    // by `code` before `status` is the guard against the regression
    // where every 409 collapsed to SYNC_NOT_READY.
    const err = {
      status: 409,
      body: { error: { code: 'NO_ACTIVE_MAILBOX', message: 'No active mailbox.' } },
    };
    expect(translateSyncNowError(err).code).toBe('NO_ACTIVE_MAILBOX');
  });

  it('maps a 409 with MAILBOX_NOT_OWNED body to MAILBOX_NOT_OWNED (not SYNC_NOT_READY)', () => {
    // Same guard, different leg: the X-Mailbox-Id header points at a
    // mailbox not in the workspace's active set (typical: stale header
    // during a switch race). Recovery is "switch your active mailbox",
    // not "wait for sync".
    const err = {
      status: 409,
      body: {
        error: {
          code: 'MAILBOX_NOT_OWNED',
          message: 'Selected mailbox is not connected to your workspace.',
        },
      },
    };
    expect(translateSyncNowError(err).code).toBe('MAILBOX_NOT_OWNED');
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

  it('falls through to UNKNOWN for unrecognised shapes', () => {
    const err = new Error('network down');
    expect(translateSyncNowError(err).code).toBe('UNKNOWN');
  });

  it('passes a pre-translated SyncNowError through unchanged', () => {
    const original = new SyncNowError('RATE_LIMITED', 'already translated', 30);
    expect(translateSyncNowError(original)).toBe(original);
  });
});
