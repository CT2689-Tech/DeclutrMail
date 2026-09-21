import { describe, expect, it } from 'vitest';

import {
  INITIAL_SYNC_RECONNECT_ERROR_CODES,
  INITIAL_SYNC_RETRY_ERROR_CODES,
  STALE_INITIAL_SYNC_MS,
  initialSyncRecovery,
  initialSyncRecoveryAction,
  isStaleInitialSync,
} from './initial-sync-recovery';

const NOW = Date.parse('2026-09-21T12:00:00.000Z');

describe('initialSyncRecovery', () => {
  it('maps ProviderPermissionError to insufficient_scopes (reconnect, never retry)', () => {
    expect(initialSyncRecovery({ errorCode: 'ProviderPermissionError', progressPct: 40 })).toEqual({
      reason: 'insufficient_scopes',
      action: 'reconnect',
      partlyReady: false,
    });
  });

  it('maps InvalidGrantError to invalid_grant (reconnect)', () => {
    expect(initialSyncRecovery({ errorCode: 'InvalidGrantError' })).toEqual({
      reason: 'invalid_grant',
      action: 'reconnect',
      partlyReady: false,
    });
  });

  it('maps AuthExpiredError to reconnect_required (reconnect)', () => {
    expect(initialSyncRecovery({ errorCode: 'AuthExpiredError' })).toEqual({
      reason: 'reconnect_required',
      action: 'reconnect',
      partlyReady: false,
    });
  });

  it('maps RateLimitError / GmailQuotaError to rate_limit (retry)', () => {
    expect(initialSyncRecovery({ errorCode: 'RateLimitError', progressPct: 0 })).toEqual({
      reason: 'rate_limit',
      action: 'retry',
      partlyReady: false,
    });
    expect(initialSyncRecovery({ errorCode: 'GmailQuotaError', progressPct: 32 })).toEqual({
      reason: 'rate_limit',
      action: 'retry',
      partlyReady: true,
    });
  });

  it('marks rate_limit as partlyReady only when progress has already moved', () => {
    expect(initialSyncRecovery({ errorCode: 'RateLimitError', progressPct: 0 }).partlyReady).toBe(
      false,
    );
    expect(initialSyncRecovery({ errorCode: 'RateLimitError', progressPct: 1 }).partlyReady).toBe(
      true,
    );
  });

  it('maps a stale heartbeat to stuck (retry), even without an error_code', () => {
    expect(initialSyncRecovery({ stuck: true, progressPct: 12 })).toEqual({
      reason: 'stuck',
      action: 'retry',
      partlyReady: true,
    });
  });

  it('defaults unknown and missing codes to unknown/retry, never reconnect', () => {
    expect(initialSyncRecovery({})).toEqual({
      reason: 'unknown',
      action: 'retry',
      partlyReady: false,
    });
    expect(initialSyncRecovery({ errorCode: 'SomeNewWorkerError' }).reason).toBe('unknown');
    expect(initialSyncRecovery({ errorCode: 'SomeNewWorkerError' }).action).toBe('retry');
  });

  it('does not treat a reconnect alias as retry just because it is unknown to older gates', () => {
    expect(INITIAL_SYNC_RECONNECT_ERROR_CODES).toContain('ProviderPermissionError');
    expect(INITIAL_SYNC_RETRY_ERROR_CODES).toContain('GmailQuotaError');
  });
});

describe('initialSyncRecoveryAction', () => {
  it.each([...INITIAL_SYNC_RECONNECT_ERROR_CODES])('reconnects for %s', (code) => {
    expect(initialSyncRecoveryAction(code)).toBe('reconnect');
  });

  it.each([...INITIAL_SYNC_RETRY_ERROR_CODES])('retries for %s', (code) => {
    expect(initialSyncRecoveryAction(code)).toBe('retry');
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
