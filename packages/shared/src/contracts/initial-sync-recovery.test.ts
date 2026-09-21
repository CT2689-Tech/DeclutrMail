import { describe, expect, it } from 'vitest';

import {
  INITIAL_SYNC_RECONNECT_ERROR_CODES,
  INITIAL_SYNC_RETRY_ERROR_CODES,
  STALE_INITIAL_SYNC_MS,
  initialSyncRecoveryAction,
  isStaleInitialSync,
} from './initial-sync-recovery';

const NOW = Date.parse('2026-09-21T12:00:00.000Z');

describe('initialSyncRecoveryAction', () => {
  it.each([...INITIAL_SYNC_RECONNECT_ERROR_CODES])(
    'reconnects for %s (insufficient scopes / invalid grant)',
    (code) => {
      expect(initialSyncRecoveryAction(code)).toBe('reconnect');
    },
  );

  it.each([...INITIAL_SYNC_RETRY_ERROR_CODES])('retries for %s (transient / quota)', (code) => {
    expect(initialSyncRecoveryAction(code)).toBe('retry');
  });

  it('defaults unknown and missing codes to retry, never reconnect', () => {
    expect(initialSyncRecoveryAction(undefined)).toBe('retry');
    expect(initialSyncRecoveryAction(null)).toBe('retry');
    expect(initialSyncRecoveryAction('SomeNewWorkerError')).toBe('retry');
  });

  it('does not treat a reconnect alias as retry just because it is unknown to older gates', () => {
    // Negative control for the ProviderPermissionError alias: if this
    // set is emptied, insufficient-scopes (once renamed) would offer
    // Try again against a grant that cannot authorize the scan.
    expect(INITIAL_SYNC_RECONNECT_ERROR_CODES).toContain('ProviderPermissionError');
  });
});

describe('isStaleInitialSync', () => {
  const syncing = { readiness_status: 'syncing' as const };

  it('is stuck when a queued/syncing heartbeat is older than the shared age gate', () => {
    const updated_at = new Date(NOW - STALE_INITIAL_SYNC_MS - 1).toISOString();
    expect(isStaleInitialSync({ ...syncing, updated_at }, NOW)).toBe(true);
    expect(isStaleInitialSync({ readiness_status: 'queued', updated_at }, NOW)).toBe(true);
  });

  it('is not stuck inside the age gate (healthy in-flight or score cascade)', () => {
    const updated_at = new Date(NOW - STALE_INITIAL_SYNC_MS + 1_000).toISOString();
    expect(isStaleInitialSync({ ...syncing, updated_at }, NOW)).toBe(false);
  });

  it('never treats failed/ready as stuck — those have their own surfaces', () => {
    const updated_at = new Date(NOW - STALE_INITIAL_SYNC_MS * 2).toISOString();
    expect(isStaleInitialSync({ readiness_status: 'failed', updated_at }, NOW)).toBe(false);
    expect(isStaleInitialSync({ readiness_status: 'ready', updated_at }, NOW)).toBe(false);
  });

  it('does not invent stuck from a missing or unparseable heartbeat', () => {
    expect(isStaleInitialSync(syncing, NOW)).toBe(false);
    expect(isStaleInitialSync({ ...syncing, updated_at: null }, NOW)).toBe(false);
    expect(isStaleInitialSync({ ...syncing, updated_at: 'not-a-date' }, NOW)).toBe(false);
  });
});
