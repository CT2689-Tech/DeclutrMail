import { describe, expect, it } from 'vitest';
import type { SyncStatus } from '@declutrmail/shared/contracts';
import { homePriority, homeSyncLine } from './home-orientation';
import { homeLaterCandidate } from './home-next-steps';

const ready: SyncStatus = {
  readiness_status: 'ready',
  current_stage: 'ready',
  progress_pct: 100,
  is_ready_for_triage: true,
  last_synced_at: '2026-10-25T10:00:00Z',
};
const now = Date.parse('2026-10-25T10:05:00Z');
const inputs = {
  sync: ready,
  needsReconnect: false,
  cleanup: 'idle' as const,
  newSenders: 0,
  laterAttention: 0,
};

describe('Home orientation', () => {
  it('names the last completed scan without claiming the inbox is current', () => {
    expect(homeSyncLine(ready, false, false, now)).toBe('Gmail connected · Last scanned 5m ago');
    expect(homeSyncLine(ready, true, false, now)).toBe('Gmail status unavailable');
    expect(homeSyncLine(undefined, false, false, now)).toBe('Checking Gmail status…');
    expect(homeSyncLine({ ...ready, last_synced_at: null }, false, false, now)).toContain(
      'Scan time unavailable',
    );
  });
  it('puts a newer incremental failure above cleanup despite ready initial status', () => {
    const sync = {
      ...ready,
      last_sync_error_at: '2026-10-25T10:04:00Z',
      last_sync_error_code: 'TemporaryError',
    };
    expect(homeSyncLine(sync, false, false, now)).toBe('Latest scan needs attention');
    expect(homePriority({ ...inputs, sync, cleanup: 'running' })?.action?.href).toBe(
      '/settings#mailboxes',
    );
    expect(
      homePriority({ ...inputs, sync: { ...sync, last_sync_error_at: '2026-10-24T10:04:00Z' } }),
    ).toBeNull();
  });
  it('offers reconnect while initial readiness stays ready', () => {
    const sync = {
      ...ready,
      last_sync_error_at: '2026-10-25T10:04:00Z',
      last_sync_error_code: 'InvalidGrantError',
    };
    expect(homePriority({ ...inputs, sync })?.title).toBe('Reconnect Gmail to continue.');
    expect(homeSyncLine(sync, false, false, now)).toBe('Gmail needs reconnect');
    // A background status-read error preserves the last-known reconnect in both surfaces.
    expect(homeSyncLine(sync, true, true, now)).toBe('Gmail needs reconnect');
    expect(homePriority({ ...inputs, sync: undefined, needsReconnect: true })?.action?.href).toBe(
      '/settings#mailboxes',
    );
    expect(homePriority({ ...inputs, needsReconnect: true })?.action?.href).toBe(
      '/settings#mailboxes',
    );
  });
  it('prioritizes running or uncertain work without a success claim', () => {
    for (const cleanup of ['running', 'unknown'] as const) {
      const priority = homePriority({ ...inputs, cleanup, newSenders: 20, laterAttention: 2 });
      expect(priority?.action?.href).toBe('/activity');
      expect(priority?.title).not.toMatch(/done|completed|success/i);
    }
  });
  it('prioritizes new review then troubled Later returns and leaves unknown neutral', () => {
    expect(homePriority({ ...inputs, newSenders: 2, laterAttention: 1 })?.action?.href).toBe(
      '/senders?view=first-review',
    );
    expect(homePriority({ ...inputs, laterAttention: 1 })?.action?.href).toBe('/later');
    expect(homePriority({ ...inputs, newSenders: null, cleanup: null })).toBeNull();
  });
  it('does not call future scheduled Later timers due, even without a clock', () => {
    const future = {
      senderId: 'future',
      snoozedUntil: '2099-01-01T00:00:00Z',
      returnStatus: 'scheduled' as const,
    };
    expect(homeLaterCandidate([future], now)).toBeNull();
    expect(homeLaterCandidate([future], null)).toBeNull();
    expect(homeLaterCandidate([{ ...future, snoozedUntil: 'invalid' }], now)).toBeNull();
    expect(homeLaterCandidate([{ ...future, returnStatus: 'missed' }], null)?.senderIds).toEqual([
      'future',
    ]);
    expect(
      homeLaterCandidate([{ ...future, snoozedUntil: '2026-10-25T10:00:00Z' }], now)?.senderCount,
    ).toBe(1);
  });
});
