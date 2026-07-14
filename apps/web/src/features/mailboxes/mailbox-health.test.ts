import { describe, expect, it } from 'vitest';
import type { SyncStatus } from '@declutrmail/shared/contracts';

import { syncStatusNeedsReconnect } from './mailbox-health';

function statusOf(overrides: Partial<SyncStatus> = {}): SyncStatus {
  return {
    readiness_status: 'ready',
    current_stage: 'ready',
    progress_pct: 100,
    is_ready_for_triage: true,
    last_synced_at: null,
    last_sync_error_at: null,
    last_sync_error_code: null,
    ...overrides,
  };
}

describe('syncStatusNeedsReconnect', () => {
  it('detects a current incremental invalid grant', () => {
    expect(
      syncStatusNeedsReconnect(
        statusOf({
          last_synced_at: '2026-07-12T10:00:00.000Z',
          last_sync_error_at: '2026-07-12T10:05:00.000Z',
          last_sync_error_code: 'InvalidGrantError',
        }),
      ),
    ).toBe(true);
  });

  it('clears the incremental invalid grant after a later success', () => {
    expect(
      syncStatusNeedsReconnect(
        statusOf({
          last_synced_at: '2026-07-12T10:06:00.000Z',
          last_sync_error_at: '2026-07-12T10:05:00.000Z',
          last_sync_error_code: 'InvalidGrantError',
        }),
      ),
    ).toBe(false);
  });

  it('detects an initial-sync invalid grant', () => {
    expect(
      syncStatusNeedsReconnect(
        statusOf({
          readiness_status: 'failed',
          current_stage: 'failed',
          is_ready_for_triage: false,
          error_code: 'InvalidGrantError',
        }),
      ),
    ).toBe(true);
  });

  it('does not classify retryable sync errors as reconnect-required', () => {
    expect(
      syncStatusNeedsReconnect(
        statusOf({
          last_sync_error_at: '2026-07-12T10:05:00.000Z',
          last_sync_error_code: 'GMAIL_HISTORY_GONE',
        }),
      ),
    ).toBe(false);
  });
});
