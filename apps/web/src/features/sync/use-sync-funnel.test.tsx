/**
 * `useSyncGateFunnel` — D159 sync lifecycle emitter tests.
 *
 * The contract under test: `sync_started` fires ONCE on the first
 * in-progress observation, `sync_completed` fires ONCE per transition
 * into a terminal readiness — and the 3s poll re-observing the same
 * state fires NOTHING (the ref guard). Payloads follow the taxonomy's
 * FE conventions: `sync_id: null`, `messages_indexed: -1`, observed
 * (not server-side) `duration_ms`.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { SyncStatus, SyncReadiness } from '@declutrmail/shared/contracts';

import { useSyncGateFunnel } from './use-sync-funnel';

const h = vi.hoisted(() => ({ track: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/posthog', () => ({ track: h.track }));

/** Build a SyncStatus for a readiness — fresh object each call, like a poll. */
function status(readiness: SyncReadiness, progressPct = 0): SyncStatus {
  return {
    readiness_status: readiness,
    current_stage: readiness === 'ready' ? 'ready' : readiness === 'failed' ? 'failed' : 'queued',
    progress_pct: progressPct,
    is_ready_for_triage: readiness === 'ready',
  };
}

function renderFunnel(initial: SyncStatus | undefined, mailboxId: string | null = 'mb-1') {
  return renderHook(
    (props: { status: SyncStatus | undefined; mailboxId: string | null }) =>
      useSyncGateFunnel(props.status, props.mailboxId),
    { initialProps: { status: initial, mailboxId } },
  );
}

const startedCalls = () => h.track.mock.calls.filter(([name]) => name === 'sync_started');
const completedCalls = () => h.track.mock.calls.filter(([name]) => name === 'sync_completed');

describe('useSyncGateFunnel (D159)', () => {
  beforeEach(() => {
    h.track.mockClear();
  });

  it('fires sync_started ONCE across queued → poll re-fire → syncing, then sync_completed ONCE on ready', () => {
    const { rerender } = renderFunnel(status('queued'));

    expect(startedCalls()).toHaveLength(1);
    expect(h.track).toHaveBeenCalledWith('sync_started', {
      sync_id: null,
      mailbox_id: 'mb-1',
      trigger: 'initial',
    });

    // Poll re-fires observing the same state (new object, same
    // readiness) + the queued→syncing progress transition: no new
    // started event.
    rerender({ status: status('queued'), mailboxId: 'mb-1' });
    rerender({ status: status('syncing', 40), mailboxId: 'mb-1' });
    rerender({ status: status('syncing', 80), mailboxId: 'mb-1' });
    expect(startedCalls()).toHaveLength(1);
    expect(completedCalls()).toHaveLength(0);

    rerender({ status: status('ready', 100), mailboxId: 'mb-1' });
    expect(completedCalls()).toHaveLength(1);
    expect(h.track).toHaveBeenCalledWith('sync_completed', {
      sync_id: null,
      mailbox_id: 'mb-1',
      messages_indexed: -1,
      duration_ms: expect.any(Number),
      outcome: 'success',
    });
    const [, payload] = completedCalls()[0]! as [string, { duration_ms: number }];
    expect(payload.duration_ms).toBeGreaterThanOrEqual(0);

    // A ready re-observation fires nothing further.
    rerender({ status: status('ready', 100), mailboxId: 'mb-1' });
    expect(completedCalls()).toHaveLength(1);
  });

  it('fires sync_completed with outcome failed on syncing → failed', () => {
    const { rerender } = renderFunnel(status('syncing', 30));
    rerender({ status: status('failed', 30), mailboxId: 'mb-1' });

    expect(startedCalls()).toHaveLength(1);
    expect(completedCalls()).toHaveLength(1);
    expect(h.track).toHaveBeenCalledWith(
      'sync_completed',
      expect.objectContaining({ outcome: 'failed', mailbox_id: 'mb-1' }),
    );
  });

  it('a mailbox already ready on mount fires NOTHING (no observed sync)', () => {
    const { rerender } = renderFunnel(status('ready', 100));
    rerender({ status: status('ready', 100), mailboxId: 'mb-1' });
    expect(h.track).not.toHaveBeenCalled();
  });

  it('never emits an unpaired completion: mount into failed → ready stays silent', () => {
    const { rerender } = renderFunnel(status('failed'));
    rerender({ status: status('ready', 100), mailboxId: 'mb-1' });
    expect(h.track).not.toHaveBeenCalled();
  });

  it('a transient failed → syncing recovery starts the pair; ready completes it', () => {
    const { rerender } = renderFunnel(status('failed'));
    rerender({ status: status('syncing', 10), mailboxId: 'mb-1' });
    rerender({ status: status('ready', 100), mailboxId: 'mb-1' });

    expect(startedCalls()).toHaveLength(1);
    expect(completedCalls()).toHaveLength(1);
    expect(h.track).toHaveBeenCalledWith(
      'sync_completed',
      expect.objectContaining({ outcome: 'success' }),
    );
  });

  it('fires nothing while status is undefined or mailboxId is null', () => {
    const { rerender } = renderFunnel(undefined);
    rerender({ status: status('syncing', 10), mailboxId: null });
    expect(h.track).not.toHaveBeenCalled();
  });
});
