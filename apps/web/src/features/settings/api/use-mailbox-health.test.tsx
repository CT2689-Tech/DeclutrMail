import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
import type { SyncStatus } from '@declutrmail/shared/contracts';

import type { MeMailbox } from '@/features/auth/api/use-me';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { useMailboxesHealth } from './use-mailbox-health';

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

  it('refreshes active-mailbox health when a backgrounded tab regains focus', async () => {
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
