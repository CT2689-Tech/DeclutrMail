import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
import type { SyncStatus } from '@declutrmail/shared/contracts';

import type { MeMailbox } from '@/features/auth/api/use-me';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { deriveMailboxHealth, useMailboxesHealth } from './use-mailbox-health';

const MAILBOX: MeMailbox = {
  id: 'mailbox-a',
  email: 'owner@example.com',
  status: 'active',
  connectedAt: '2026-07-01T00:00:00.000Z',
  readiness: 'ready',
};

function ready(lastSyncedAt: string): SyncStatus {
  return {
    readiness_status: 'ready',
    current_stage: 'ready',
    progress_pct: 100,
    is_ready_for_triage: true,
    last_synced_at: lastSyncedAt,
  };
}

describe('useMailboxesHealth', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => {
    focusManager.setFocused(undefined);
    resetFetchStub();
  });

  it('refreshes stale mailbox health when a backgrounded tab regains focus', async () => {
    let requests = 0;
    focusManager.setFocused(false);
    installFetchStub([
      {
        method: 'GET',
        path: '/api/v1/sync/status',
        respond: () => {
          requests += 1;
          const stamp = requests === 1 ? '2026-07-12T10:00:00.000Z' : '2026-07-12T10:01:00.000Z';
          return jsonOk({ data: ready(stamp) });
        },
      },
    ]);
    const client = createTestQueryClient();
    const { result, unmount } = renderHook(() => useMailboxesHealth([MAILBOX]), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    await waitFor(() =>
      expect(result.current[MAILBOX.id]?.lastSyncedAt).toBe('2026-07-12T10:00:00.000Z'),
    );

    const cached = client.getQueryCache().find({ queryKey: ['sync', 'status', MAILBOX.id] });
    cached?.setState({ ...cached.state, dataUpdatedAt: Date.now() - 60_000 });
    act(() => focusManager.setFocused(true));
    await waitFor(() => {
      expect(requests).toBe(2);
      expect(result.current[MAILBOX.id]?.lastSyncedAt).toBe('2026-07-12T10:01:00.000Z');
    });
    unmount();
    client.clear();
  });

  it('defers mailbox health reads until an optional consumer is enabled', async () => {
    let requests = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/v1/sync/status',
        respond: () => {
          requests += 1;
          return jsonOk({ data: ready('2026-07-12T10:00:00.000Z') });
        },
      },
    ]);
    const client = createTestQueryClient();
    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => useMailboxesHealth([MAILBOX], { enabled }),
      {
        initialProps: { enabled: false },
        wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
      },
    );

    expect(requests).toBe(0);
    expect(result.current[MAILBOX.id]).toBeUndefined();

    rerender({ enabled: true });
    await waitFor(() => {
      expect(requests).toBe(1);
      expect(result.current[MAILBOX.id]?.lastSyncedAt).toBe('2026-07-12T10:00:00.000Z');
    });
    unmount();
    client.clear();
  });
});

describe('deriveMailboxHealth — hasSyncError (QA-sync-20260831-04)', () => {
  it('flags a persistent incremental failure that readiness never surfaces', () => {
    // The negative control: reverting `hasSyncError`'s derivation makes
    // this assertion fail — `readiness_status` stays `'ready'` for an
    // incremental failure by the worker's own design, so before this
    // field existed a persistently-broken mailbox was indistinguishable
    // from a healthy one in this projection.
    const health = deriveMailboxHealth({
      readiness_status: 'ready',
      current_stage: 'ready',
      progress_pct: 100,
      is_ready_for_triage: true,
      last_synced_at: '2026-08-01T00:00:00.000Z',
      last_sync_error_at: '2026-08-20T00:00:00.000Z',
      last_sync_error_code: 'RateLimitError',
    });
    expect(health.hasSyncError).toBe(true);
    expect(health.needsReconnect).toBe(false);
  });

  it('clears once a later success supersedes the failure', () => {
    const health = deriveMailboxHealth({
      readiness_status: 'ready',
      current_stage: 'ready',
      progress_pct: 100,
      is_ready_for_triage: true,
      last_synced_at: '2026-08-20T00:00:00.000Z',
      last_sync_error_at: '2026-08-01T00:00:00.000Z',
      last_sync_error_code: 'RateLimitError',
    });
    expect(health.hasSyncError).toBe(false);
  });

  it('flags a tie between the error and success stamps, instead of reading it as healthy (Codex adversarial review)', () => {
    // The negative control: reverting `>=` back to strict `>` makes this
    // fail. The two stamps are written by mutually exclusive worker
    // outcomes, so a genuine tie should never happen in practice — but
    // if it did, this codebase's posture is to surface a possible
    // problem rather than silently call it healthy.
    const health = deriveMailboxHealth({
      readiness_status: 'ready',
      current_stage: 'ready',
      progress_pct: 100,
      is_ready_for_triage: true,
      last_synced_at: '2026-08-20T00:00:00.000Z',
      last_sync_error_at: '2026-08-20T00:00:00.000Z',
      last_sync_error_code: 'RateLimitError',
    });
    expect(health.hasSyncError).toBe(true);
  });

  it('does not double-count an InvalidGrantError as a plain sync error — needsReconnect already owns it', () => {
    const health = deriveMailboxHealth({
      readiness_status: 'ready',
      current_stage: 'ready',
      progress_pct: 100,
      is_ready_for_triage: true,
      last_synced_at: '2026-08-01T00:00:00.000Z',
      last_sync_error_at: '2026-08-20T00:00:00.000Z',
      last_sync_error_code: 'InvalidGrantError',
    });
    expect(health.needsReconnect).toBe(true);
    expect(health.hasSyncError).toBe(false);
  });
});
