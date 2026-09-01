/**
 * Tests for `useRetryInitialSync` — the mutation behind every "Try
 * again"/"Scan again"/"Reconnect Gmail" control on a failed initial
 * sync (the onboarding gate, Settings → Gmail accounts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { useRetryInitialSync } from './use-retry-initial-sync';

vi.mock('@declutrmail/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: vi.fn() };
});

import { toast } from '@declutrmail/shared';

describe('useRetryInitialSync', () => {
  beforeEach(() => {
    installFetchStub([]);
    vi.mocked(toast).mockClear();
  });
  afterEach(() => resetFetchStub());

  function renderRetry(mailboxId: string | null = 'mb-1') {
    const client = createTestQueryClient();
    return renderHook(() => useRetryInitialSync(mailboxId), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });
  }

  it('does not toast on a successful requeue', async () => {
    installFetchStub([
      {
        method: 'POST',
        path: '/api/v1/sync/initial/retry',
        respond: () => jsonOk({ data: { outcome: 'requeued' } }),
      },
    ]);
    const { result } = renderRetry();
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(vi.mocked(toast)).not.toHaveBeenCalled();
  });

  it('toasts a real message on failure, instead of silently doing nothing (QA-sync-20260831-10 item 4)', async () => {
    // The negative control: reverting the `onError` handler makes this
    // assertion fail — a 429 or 5xx on the user's only recovery control
    // used to fail with no visible feedback at all.
    installFetchStub([
      {
        method: 'POST',
        path: '/api/v1/sync/initial/retry',
        respond: () =>
          new Response(JSON.stringify({ error: { code: 'RATE_LIMITED' } }), {
            status: 429,
            headers: { 'content-type': 'application/json' },
          }),
      },
    ]);
    const { result } = renderRetry();
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(vi.mocked(toast)).toHaveBeenCalledWith(
      "Couldn't start the scan. Wait a minute and try again — nothing in Gmail changed.",
      'danger',
    );
  });
});
