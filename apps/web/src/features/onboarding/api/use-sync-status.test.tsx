/**
 * Tests for `useSyncStatus` — the sync-gate polling hook (D109, D224).
 *
 * Verifies the success branch resolves the SyncStatus payload and the
 * `refetchInterval` policy: poll quickly while syncing, more slowly on
 * failed/ready states, and heal a paused tab on focus once the cached
 * reading is stale. We assert the policy function directly off
 * `query.state` rather than racing real timers — the cadence value is
 * the contract, not wall-clock behaviour.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
import type { SyncStatus } from '@declutrmail/shared/contracts';
import {
  useSyncStatus,
  syncRefetchInterval,
  SYNC_POLL_MS,
  SYNC_FAILED_POLL_MS,
  SYNC_READY_POLL_MS,
  SYNC_STATUS_KEY,
} from './use-sync-status';
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
  afterEach(() => {
    focusManager.setFocused(undefined);
    resetFetchStub();
  });

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

  it('stamps X-Active-Mailbox-Id when an explicit mailboxId is passed (D116)', async () => {
    let seenHeader: string | null = null;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/v1/sync/status',
        respond: (req) => {
          seenHeader = req.headers.get('X-Active-Mailbox-Id');
          return jsonOk({ data: SYNCING });
        },
      },
    ]);
    const client = createTestQueryClient();
    const { result } = renderHook(() => useSyncStatus('mailbox-b'), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenHeader).toBe('mailbox-b');
  });

  it('uses fast syncing, slower failed, and low-frequency ready cadences', () => {
    // While syncing → keep the cadence.
    expect(syncRefetchInterval(SYNCING)).toBe(SYNC_POLL_MS);
    // No data yet (first paint) → still poll.
    expect(syncRefetchInterval(undefined)).toBe(SYNC_POLL_MS);
    // Ready → retain a low-frequency health poll so freshness/error
    // state cannot freeze for the rest of a long-lived app session.
    expect(syncRefetchInterval(READY)).toBe(SYNC_READY_POLL_MS);
    // Failed → keep polling at the slower cadence so a transient/superseded
    // failure recovers instead of trapping the gate (2026-05-28).
    expect(
      syncRefetchInterval({
        readiness_status: 'failed',
        current_stage: 'failed',
        progress_pct: 12,
        is_ready_for_triage: false,
        error_code: 'RateLimitError',
      }),
    ).toBe(SYNC_FAILED_POLL_MS);
    // ERRORED → STOP. `!data` is true for "not loaded yet" AND for
    // "errored", so this used to fall through to the 3s cadence and
    // re-issue forever: `retry` correctly refuses a 4xx, and the
    // interval re-issued a fresh query anyway. Two of the three
    // consumers are always-mounted chrome that render `null` on error,
    // so the storm was invisible in the UI (audit 2026-08-21).
    expect(syncRefetchInterval(undefined, true)).toBe(false);
    expect(syncRefetchInterval(SYNCING, true)).toBe(false);
  });

  it('refetches ready status on focus only after the cached reading goes stale', async () => {
    let requests = 0;
    focusManager.setFocused(false);
    installFetchStub([
      {
        method: 'GET',
        path: '/api/v1/sync/status',
        respond: () => {
          requests += 1;
          return jsonOk({ data: READY });
        },
      },
    ]);
    const client = createTestQueryClient();
    const { result, unmount } = renderHook(() => useSyncStatus(), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requests).toBe(1);

    act(() => focusManager.setFocused(true));
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(requests).toBe(1);

    const cached = client.getQueryCache().find({ queryKey: [...SYNC_STATUS_KEY, null] });
    cached?.setState({ ...cached.state, dataUpdatedAt: Date.now() - 60_000 });
    act(() => focusManager.setFocused(false));
    act(() => focusManager.setFocused(true));
    await waitFor(() => {
      expect(requests).toBe(2);
      expect(result.current.isFetching).toBe(false);
    });
    unmount();
    client.clear();
  });
});
