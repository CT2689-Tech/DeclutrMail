/**
 * Tests for `useSetSenderPolicy` (D40, D42, D43).
 *
 * Three contracts matter:
 *   • the PATCH carries the set-state body to `/api/senders/:id/policy`
 *     and resolves to the unwrapped result;
 *   • success invalidates the senders + activity caches (the hook owns
 *     invalidation so every consumer surface refreshes identically);
 *   • a failure surfaces as an error WITHOUT invalidating (callers roll
 *     back their optimistic flip in `onError`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useSetSenderPolicy } from './use-sender-policy';
import { ApiError } from '@/lib/api/client';
import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

const SENDER_ID = '22222222-2222-2222-2222-222222222222';

const RESULT = {
  senderId: SENDER_ID,
  policyType: 'keep' as const,
  isProtected: true,
  protectionReason: 'user_defined' as const,
  protectionSetAt: '2026-04-01T00:00:00.000Z',
  changed: true,
};

describe('useSetSenderPolicy', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('PATCHes the set-state body and resolves the unwrapped result', async () => {
    let capturedBody: unknown = null;
    installFetchStub([
      {
        method: 'PATCH',
        path: `/api/senders/${SENDER_ID}/policy`,
        respond: async (req) => {
          capturedBody = await req.json();
          return jsonOk({ data: RESULT });
        },
      },
    ]);

    const client = createTestQueryClient();
    const { result } = renderHook(() => useSetSenderPolicy(), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    result.current.mutate({ senderId: SENDER_ID, patch: { isProtected: true } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toEqual({ isProtected: true });
    expect(result.current.data).toEqual(RESULT);
  });

  it('invalidates the senders + activity caches on success', async () => {
    installFetchStub([
      {
        method: 'PATCH',
        path: `/api/senders/${SENDER_ID}/policy`,
        respond: () => jsonOk({ data: { ...RESULT, policyType: 'keep' } }),
      },
    ]);

    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSetSenderPolicy(), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    result.current.mutate({ senderId: SENDER_ID, patch: { policyType: 'keep' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = invalidate.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(['senders']);
    expect(keys).toContainEqual(['activity']);
  });

  it('surfaces a failure as an ApiError without invalidating', async () => {
    installFetchStub([
      {
        method: 'PATCH',
        path: `/api/senders/${SENDER_ID}/policy`,
        respond: () => jsonServerError(),
      },
    ]);

    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSetSenderPolicy(), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    result.current.mutate({ senderId: SENDER_ID, patch: { isProtected: true } });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).status).toBe(500);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
