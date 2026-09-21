/**
 * Shared D159 sync-lifecycle emitter — pairing + last_synced_at.
 *
 * Negative controls (these fail against the old gate-only refs):
 *   - a remount after an in-progress observation still completes
 *   - two observers in one tick emit one start and one completion
 *   - first last_synced_at is silent; a later different stamp completes
 *   - null → timestamp (initial-sync stamp) does not double-count
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ track: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/posthog', () => ({ track: h.track }));

import {
  markManualSyncRequested,
  observeLastSyncedAt,
  observeSyncReadiness,
  resetSyncLifecycleForTests,
} from './sync-lifecycle';

const started = () => h.track.mock.calls.filter(([name]) => name === 'sync_started');
const completed = () => h.track.mock.calls.filter(([name]) => name === 'sync_completed');

describe('observeSyncReadiness', () => {
  beforeEach(() => {
    h.track.mockClear();
    resetSyncLifecycleForTests();
  });

  it('fires one start then one success completion, and ignores poll re-fires', () => {
    observeSyncReadiness('mb-1', 'queued');
    observeSyncReadiness('mb-1', 'queued');
    observeSyncReadiness('mb-1', 'syncing');
    expect(started()).toHaveLength(1);
    expect(completed()).toHaveLength(0);

    observeSyncReadiness('mb-1', 'ready');
    observeSyncReadiness('mb-1', 'ready');
    expect(completed()).toHaveLength(1);
    expect(h.track).toHaveBeenCalledWith(
      'sync_completed',
      expect.objectContaining({
        sync_id: null,
        mailbox_id: 'mb-1',
        messages_indexed: -1,
        outcome: 'success',
      }),
    );
  });

  it('two observers of the same mailbox do not double-count', () => {
    observeSyncReadiness('mb-1', 'syncing');
    observeSyncReadiness('mb-1', 'syncing');
    observeSyncReadiness('mb-1', 'ready');
    observeSyncReadiness('mb-1', 'ready');
    expect(started()).toHaveLength(1);
    expect(completed()).toHaveLength(1);
  });

  it('a remount after in-progress still completes the stored pair', () => {
    observeSyncReadiness('mb-1', 'syncing');
    expect(started()).toHaveLength(1);

    // Simulate a new JS module consumer in the same tab: memory is
    // still there, and sessionStorage would be too after a refresh
    // (reset is NOT called). Completing from ready-on-"mount" is the
    // refresh-mid-scan gap the gate-only refs dropped.
    observeSyncReadiness('mb-1', 'ready');
    expect(completed()).toHaveLength(1);
    expect(h.track).toHaveBeenCalledWith(
      'sync_completed',
      expect.objectContaining({ outcome: 'success', mailbox_id: 'mb-1' }),
    );
  });

  it('already-ready with no stored pair stays silent', () => {
    observeSyncReadiness('mb-1', 'ready');
    expect(h.track).not.toHaveBeenCalled();
  });

  it('failed → ready with no in-progress observation in between stays silent', () => {
    observeSyncReadiness('mb-1', 'syncing');
    observeSyncReadiness('mb-1', 'failed');
    expect(completed()).toHaveLength(1);
    h.track.mockClear();
    observeSyncReadiness('mb-1', 'ready');
    expect(h.track).not.toHaveBeenCalled();
  });
});

describe('observeLastSyncedAt', () => {
  beforeEach(() => {
    h.track.mockClear();
    resetSyncLifecycleForTests();
  });

  it('records the first stamp silently and fires on a later different stamp', () => {
    observeLastSyncedAt('mb-1', '2026-09-01T00:00:00.000Z', 'ready');
    expect(h.track).not.toHaveBeenCalled();

    observeLastSyncedAt('mb-1', '2026-09-01T00:10:00.000Z', 'ready');
    expect(started()).toHaveLength(1);
    expect(completed()).toHaveLength(1);
    expect(h.track).toHaveBeenCalledWith(
      'sync_started',
      expect.objectContaining({ mailbox_id: 'mb-1', trigger: 'pubsub' }),
    );
    expect(h.track).toHaveBeenCalledWith(
      'sync_completed',
      expect.objectContaining({ mailbox_id: 'mb-1', outcome: 'success', duration_ms: 0 }),
    );
  });

  it('does not treat the initial-sync null → timestamp stamp as a second completion', () => {
    observeLastSyncedAt('mb-1', null, 'syncing');
    observeSyncReadiness('mb-1', 'syncing');
    observeSyncReadiness('mb-1', 'ready');
    expect(completed()).toHaveLength(1);

    observeLastSyncedAt('mb-1', '2026-09-01T00:00:00.000Z', 'ready');
    expect(completed()).toHaveLength(1);
  });

  it('attributes a stamp advance as manual after Sync-now', () => {
    const now = vi.spyOn(Date, 'now');
    try {
      now.mockReturnValue(1_000);
      observeLastSyncedAt('mb-1', '2026-09-01T00:00:00.000Z', 'ready');
      markManualSyncRequested('mb-1');
      now.mockReturnValue(4_000);
      observeLastSyncedAt('mb-1', '2026-09-01T00:01:00.000Z', 'ready');
      expect(h.track).toHaveBeenCalledWith(
        'sync_started',
        expect.objectContaining({ trigger: 'manual', mailbox_id: 'mb-1' }),
      );
      expect(h.track).toHaveBeenCalledWith(
        'sync_completed',
        expect.objectContaining({ duration_ms: 3_000, outcome: 'success' }),
      );
    } finally {
      now.mockRestore();
    }
  });
});
