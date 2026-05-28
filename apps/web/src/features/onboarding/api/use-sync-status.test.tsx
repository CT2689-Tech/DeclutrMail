/**
 * Tests for `useSyncStatus` — the sync-gate polling hook (D109, D224).
 *
 * Verifies the success branch resolves the SyncStatus payload and the
 * `refetchInterval` policy: keep polling while syncing, stop on a
 * terminal state (ready or failed). We assert the policy function
 * directly off `query.state` rather than racing real timers — the
 * cadence value is the contract, not wall-clock behaviour.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { SyncStatus } from '@declutrmail/shared/contracts';
import { useSyncStatus, syncRefetchInterval, SYNC_POLL_MS } from './use-sync-status';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

const SYNCING: SyncStatus = {
  readiness_status: 'syncing',
  current_stage: 'fetching_metadata',
  progress_pct: 30,
  is_ready_for_triage: false,
};

const READY: SyncStatus = {
  readiness_status: 'ready',
  current_stage: 'ready',
  progress_pct: 100,
  is_ready_for_triage: true,
};

describe('useSyncStatus', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('resolves the SyncStatus payload from /api/v1/sync/status', async () => {
    installFetchStub([
      { method: 'GET', path: '/api/v1/sync/status', respond: () => jsonOk({ data: SYNCING }) },
    ]);
    const client = createTestQueryClient();
    const { result } = renderHook(() => useSyncStatus(), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(SYNCING);
  });

  it('polls while syncing and stops on a terminal state', () => {
    // While syncing → keep the cadence.
    expect(syncRefetchInterval(SYNCING)).toBe(SYNC_POLL_MS);
    // No data yet (first paint) → still poll.
    expect(syncRefetchInterval(undefined)).toBe(SYNC_POLL_MS);
    // Ready → stop.
    expect(syncRefetchInterval(READY)).toBe(false);
    // Failed → stop.
    expect(
      syncRefetchInterval({
        readiness_status: 'failed',
        current_stage: 'failed',
        progress_pct: 12,
        is_ready_for_triage: false,
        error_code: 'GMAIL_QUOTA_EXCEEDED',
      }),
    ).toBe(false);
  });
});
