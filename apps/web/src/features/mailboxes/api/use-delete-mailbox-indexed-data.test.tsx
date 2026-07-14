import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { useDeleteMailboxIndexedData } from './use-delete-mailbox-indexed-data';

describe('useDeleteMailboxIndexedData', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('posts the mailbox-specific phrase and resets mailbox-scoped cache', async () => {
    let posted: unknown;
    installFetchStub([
      {
        method: 'POST',
        path: '/api/mailboxes/11111111-1111-4111-8111-111111111111/indexed-data-deletion',
        respond: async (request) => {
          posted = await request.json();
          return jsonOk({
            data: {
              mailbox: {
                id: '11111111-1111-4111-8111-111111111111',
                email: 'person@example.com',
                status: 'disconnected',
                indexedDataState: 'deletion_pending',
              },
              request: {
                id: '22222222-2222-4222-8222-222222222222',
                status: 'pending',
                requestedAt: '2026-07-14T00:00:00.000Z',
                startedAt: null,
                completedAt: null,
              },
            },
          });
        },
      },
    ]);
    const client = createTestQueryClient();
    client.setQueryData(['senders', 'list'], [{ id: 'stale' }]);

    const { result } = renderHook(() => useDeleteMailboxIndexedData(), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });
    result.current.mutate({
      mailboxId: '11111111-1111-4111-8111-111111111111',
      confirmPhrase: 'DELETE person@example.com',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(posted).toEqual({ confirmPhrase: 'DELETE person@example.com' });
    expect(client.getQueryState(['senders', 'list'])?.isInvalidated).toBe(true);
  });
});
