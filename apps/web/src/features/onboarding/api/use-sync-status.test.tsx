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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { focusManager, onlineManager } from '@tanstack/react-query';
import type { SyncStatus } from '@declutrmail/shared/contracts';
import {
  useSyncStatus,
  syncRefetchInterval,
  syncFailureStep,
  syncErrorBackoffMs,
  resetSyncFailureSteps,
  syncStatusQueryOptions,
  SYNC_POLL_MS,
  SYNC_FAILED_POLL_MS,
  SYNC_READY_POLL_MS,
  SYNC_ERROR_BACKOFF_CAP_MS,
  SYNC_STATUS_KEY,
} from './use-sync-status';
import { ApiError } from '@/lib/api/client';
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
    resetSyncFailureSteps();
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
    // Permanent 4xx → STOP. `!data` is true for "not loaded yet" AND for
    // "errored", so this used to fall through to the 3s cadence and
    // re-issue forever: `retry` correctly refuses a 4xx, and the
    // interval re-issued a fresh query anyway. Two of the three
    // consumers are always-mounted chrome that render `null` on error,
    // so the storm was invisible in the UI (audit 2026-08-21).
    expect(syncRefetchInterval(undefined, new ApiError(409, {}, 'conflict'))).toBe(false);
    expect(syncRefetchInterval(SYNCING, new ApiError(403, {}, 'forbidden'))).toBe(false);
    expect(syncRefetchInterval(SYNCING, new ApiError(429, {}, 'rate limited'))).toBe(
      SYNC_FAILED_POLL_MS,
    );
    // Auth stops. A gateway timeout, including HTTP 481, backs off.
    expect(syncRefetchInterval(READY, new ApiError(401, {}, 'unauthorized'))).toBe(false);
    expect(syncRefetchInterval(READY, new ApiError(403, {}, 'forbidden'))).toBe(false);
    expect(syncRefetchInterval(READY, new ApiError(481, {}, 'timed out'))).toBe(
      SYNC_FAILED_POLL_MS,
    );
    expect(
      syncRefetchInterval(READY, new DOMException('The operation timed out', 'TimeoutError'), 2),
    ).toBe(20_000);
    expect(syncErrorBackoffMs(1)).toBe(SYNC_FAILED_POLL_MS);
    expect(syncErrorBackoffMs(6)).toBe(SYNC_ERROR_BACKOFF_CAP_MS);
    const key = ['sync', 'status', 'mb'] as const;
    expect(syncFailureStep(key, 1, 'error')).toBe(1);
    expect(syncFailureStep(key, 1, 'error')).toBe(1);
    expect(syncFailureStep(key, 1, 'pending')).toBe(1);
    expect(syncFailureStep(key, 2, 'error')).toBe(2);
    expect(syncFailureStep(key, 2, 'success')).toBe(0);
    expect(syncFailureStep(key, 3, 'error')).toBe(1);
  });

  it.each([
    {
      label: 'ApiError: unavailable',
      failure: new ApiError(503, {}, 'unavailable'),
      // A 503 is a response, so the client does not replay it.
      giveUpAfter: 2,
    },
    {
      label: 'TypeError: Failed to fetch',
      failure: new TypeError('Failed to fetch'),
      // The status poll does not replay a thrown fetch. The first read
      // and the explicit refetch each fail once; the interval recovers.
      giveUpAfter: 2,
    },
  ])(
    'recovers a failed status poll without a focus event ($label)',
    async ({ failure, giveUpAfter }) => {
      let requests = 0;
      installFetchStub([
        {
          method: 'GET',
          path: '/api/v1/sync/status',
          respond: () => {
            requests += 1;
            if (requests <= giveUpAfter) throw failure;
            return jsonOk({ data: READY });
          },
        },
      ]);
      const client = createTestQueryClient();
      const { result, unmount } = renderHook(() => useSyncStatus(), {
        wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
      });
      await waitFor(() => expect(result.current.isError).toBe(true));
      vi.useFakeTimers();
      try {
        // Start the timer from the errored cache, with no remount or focus change.
        await act(async () => {
          await client.refetchQueries({ queryKey: [...SYNC_STATUS_KEY, null], type: 'active' });
        });
        const failedReads = requests;
        await act(async () => {
          // Second failure uses the 20s step, so 15s is still inside it.
          await vi.advanceTimersByTimeAsync(15_000);
        });
        expect(requests).toBe(failedReads);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(6_000);
        });
        expect(requests).toBe(giveUpAfter + 1);
        expect(result.current.data).toEqual(READY);
      } finally {
        unmount();
        client.clear();
        vi.useRealTimers();
      }
    },
  );

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

  it('pauses the Home scan poll while the tab is hidden and resumes on the next tick', async () => {
    let reads = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/v1/sync/status',
        respond: () => {
          reads += 1;
          return jsonOk({ data: SYNCING });
        },
      },
    ]);
    const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    const setVisibility = (value: DocumentVisibilityState) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value });
    };
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
    setVisibility('visible');
    const client = createTestQueryClient();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { result, unmount } = renderHook(() => useSyncStatus('mailbox-home'), {
        wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const baseline = reads;
      expect(baseline).toBeGreaterThan(0);
      expect(
        syncStatusQueryOptions('mailbox-home', async () => SYNCING).refetchIntervalInBackground,
      ).toBe(false);

      setVisibility('hidden');
      await act(async () => {
        client.setQueryData(
          [...SYNC_STATUS_KEY, 'mailbox-home'],
          (current: SyncStatus | undefined) => (current === undefined ? current : { ...current }),
        );
        await vi.advanceTimersByTimeAsync(SYNC_POLL_MS);
      });
      expect(reads).toBe(baseline);

      setVisibility('visible');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SYNC_POLL_MS);
      });
      expect(reads).toBe(baseline + 1);
      unmount();
      client.clear();
    } finally {
      vi.useRealTimers();
      focusManager.setFocused(undefined);
      onlineManager.setOnline(true);
      if (originalVisibility)
        Object.defineProperty(document, 'visibilityState', originalVisibility);
    }
  });
});
