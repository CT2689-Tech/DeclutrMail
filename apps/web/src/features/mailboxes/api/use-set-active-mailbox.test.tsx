import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { useSetActiveMailbox } from './use-set-active-mailbox';

describe('useSetActiveMailbox', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('invalidates client state after the active mailbox changes', async () => {
    installFetchStub([
      {
        method: 'PATCH',
        path: '/api/mailboxes/mb-2/active',
        respond: () => jsonOk({ data: { activeMailboxId: 'mb-2' } }),
      },
    ]);
    const client = createTestQueryClient();
    client.setQueryData(['senders', 'list'], [{ id: 'mailbox-1-data' }]);

    const { result } = renderHook(() => useSetActiveMailbox(), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });
    result.current.mutate('mb-2');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryState(['senders', 'list'])?.isInvalidated).toBe(true);
  });
});
