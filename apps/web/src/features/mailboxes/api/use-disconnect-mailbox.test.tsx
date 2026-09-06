/**
 * Tests for `useDisconnectMailbox` — the regression guard for the
 * stale-screen bug (2026-05-28): disconnecting the active mailbox must
 * drop the previous mailbox's feature data, not just refresh `me`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDisconnectMailbox } from './use-disconnect-mailbox';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

describe('useDisconnectMailbox', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('drops cached feature data on success so the dashboard reloads', async () => {
    installFetchStub([
      {
        method: 'DELETE',
        path: '/api/mailboxes/mb-1',
        respond: () => jsonOk({ data: { id: 'mb-1', email: 'a@x.com', status: 'disconnected' } }),
      },
    ]);
    const client = createTestQueryClient();
    // Seed the previous mailbox's senders list.
    client.setQueryData(['senders', 'list'], [{ id: 'stale' }]);

    const { result } = renderHook(() => useDisconnectMailbox(), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    result.current.mutate('mb-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Unmounted routes must not retain data from the previous mailbox.
    expect(client.getQueryData(['senders', 'list'])).toBeUndefined();
  });
});
