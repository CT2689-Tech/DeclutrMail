import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { resetMailboxScopedCache } from '@/features/mailboxes/api/reset-mailbox-cache';
import { useDismissFollowup } from './use-dismiss-followup';
import { followupsKeys } from './query-keys';
import type { FollowupRow } from '@/lib/api/followups';
const h = vi.hoisted(() => ({ dismiss: vi.fn() }));
vi.mock('@/lib/api/followups', () => ({ postDismissFollowup: h.dismiss }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
const row = (id: string) =>
  ({ id, priority: 'high', recipientEmail: `${id}@synthetic.test` }) as FollowupRow;
const envelope = (ids: string[]) => ({ data: ids.map(row) });
beforeEach(() => vi.clearAllMocks());
it('a failed old-mailbox mutation cannot restore its rows into the new mailbox', async () => {
  const client = createTestQueryClient();
  client.setQueryData(followupsKeys.list(), envelope(['a']));
  let fail!: (reason: Error) => void;
  h.dismiss.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );
  const { result } = renderHook(() => useDismissFollowup(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryWrapper client={client}>{children}</QueryWrapper>
    ),
  });
  let pending!: Promise<unknown>;
  act(() => {
    pending = result.current.mutateAsync(row('a')).catch(() => {});
  });
  await waitFor(() => expect(h.dismiss).toHaveBeenCalled());
  await act(async () => {
    await resetMailboxScopedCache(client);
  });
  client.setQueryData(followupsKeys.list(), envelope(['b']));
  await act(async () => {
    fail(new Error('old request failed'));
    await pending;
  });
  expect(client.getQueryData(followupsKeys.list())).toEqual(envelope(['b']));
  expect(client.getQueryState(followupsKeys.list())?.isInvalidated).toBe(true);
});
it('a failed dismissal cannot resurrect a sibling that already succeeded', async () => {
  const client = createTestQueryClient();
  client.setQueryData(followupsKeys.list(), envelope(['a', 'b']));
  let fail!: (reason: Error) => void;
  h.dismiss.mockImplementation((id: string) =>
    id === 'a'
      ? new Promise((_resolve, reject) => {
          fail = reject;
        })
      : Promise.resolve({ data: { alreadyDismissed: false } }),
  );
  const { result } = renderHook(() => useDismissFollowup(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryWrapper client={client}>{children}</QueryWrapper>
    ),
  });
  let pending!: Promise<unknown>;
  act(() => {
    pending = result.current.mutateAsync(row('a')).catch(() => {});
  });
  await waitFor(() => expect(h.dismiss).toHaveBeenCalledWith('a'));
  await act(async () => {
    await result.current.mutateAsync(row('b'));
  });
  await act(async () => {
    fail(new Error('failed'));
    await pending;
  });
  expect(client.getQueryData(followupsKeys.list())).toEqual(envelope([]));
  // With no mounted reader, remain stale until the next fetch; never invent server state.
  expect(client.getQueryState(followupsKeys.list())?.isInvalidated).toBe(true);
});
