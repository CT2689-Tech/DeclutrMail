import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub } from '@/test/fetch-stub';
import { useSyncNow } from './use-sync-now';

vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ me: { activeMailboxId: 'active-mailbox' } }),
}));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ addBreadcrumb: vi.fn() }));
vi.mock('@declutrmail/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: vi.fn() };
});

import { toast } from '@declutrmail/shared';

describe('manual sync mailbox ownership', () => {
  it.each([
    ['displayed-mailbox', 'displayed-mailbox'],
    [undefined, 'active-mailbox'],
  ])('pins the request when the displayed mailbox is %s', async (mailboxId, expected) => {
    const ids: Array<string | null> = [];
    installFetchStub([
      {
        method: 'POST',
        path: '/api/v1/sync/incremental',
        respond: (request) => {
          ids.push(request.headers.get('X-Active-Mailbox-Id'));
          return Response.json({ data: { outcome: 'enqueued', cursor_history_id: '123' } });
        },
      },
    ]);
    const client = createTestQueryClient();
    const { result } = renderHook(() => useSyncNow('app_shell', mailboxId), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(ids).toEqual([expected]);
  });
});

describe('manual sync toast', () => {
  it('a sync already queued promises no time and no new mail', async () => {
    // `noop` only proves a job is already waiting or running.
    installFetchStub([
      {
        method: 'POST',
        path: '/api/v1/sync/incremental',
        respond: () => Response.json({ data: { outcome: 'noop' } }),
      },
    ]);
    const client = createTestQueryClient();
    const { result } = renderHook(() => useSyncNow('app_shell', 'displayed-mailbox'), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });
    await act(async () => {
      await result.current.mutateAsync();
    });
    const [message] = vi.mocked(toast).mock.calls.at(-1)!;
    expect(message).toMatch(/already in progress/i);
    expect(message).not.toMatch(/shortly|soon|minute|will appear/i);
  });
});
