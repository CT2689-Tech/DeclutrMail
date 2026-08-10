// Tests for the standing-policy mutation hook — specifically its
// INVALIDATION SET and the D159 unprotect telemetry.
//
// The invalidation set is the hook's contract (its docblock says so):
// every surface that renders protection state must refresh when the
// state changes. The 2026-08-10 flow audit found `SCREENER_QUEUE_KEY`
// missing from that set — the Screener decide-preview kept asserting
// "safe because Protected · …" for up to 30s after an Unprotect from
// the two entry points #483 added. This file pins the full key set so
// the next surface added to the union has a test to fail.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const trackSpy = vi.hoisted(() => vi.fn());
vi.mock('@/lib/posthog', () => ({ track: trackSpy }));

import { QueryWrapper, createTestQueryClient } from '@/test/query-wrapper';
import { installFetchStub, resetFetchStub } from '@/test/fetch-stub';
import { SCREENER_QUEUE_KEY } from '@/features/screener/api/use-screener';
import { TRIAGE_QUEUE_KEY } from '@/features/triage/api/use-triage-queue';
import { activityKeys } from '@/features/activity/api/query-keys';
import { sendersKeys } from './query-keys';
import { useSetSenderPolicy } from './use-sender-policy';

function okPolicy() {
  return new Response(
    JSON.stringify({
      data: { senderId: 's1', policyType: null, isProtected: false, protectionReason: null },
      meta: {},
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('useSetSenderPolicy', () => {
  beforeEach(() => {
    trackSpy.mockClear();
    installFetchStub([
      { method: 'PATCH', path: /\/api\/senders\/[^/]+\/policy/, respond: okPolicy },
    ]);
  });
  afterEach(() => resetFetchStub());

  it('invalidates senders, activity, triage AND screener caches on success', async () => {
    const client = createTestQueryClient();
    const invalidated: unknown[] = [];
    const original = client.invalidateQueries.bind(client);
    vi.spyOn(client, 'invalidateQueries').mockImplementation(
      (...args: Parameters<typeof original>) => {
        invalidated.push((args[0] as { queryKey?: unknown } | undefined)?.queryKey);
        return original(...args);
      },
    );

    const { result } = renderHook(() => useSetSenderPolicy(), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    act(() => {
      result.current.mutate({ senderId: 's1', patch: { isProtected: false } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The full contract, not a subset: a missing key here is a surface
    // asserting stale protection state somewhere.
    expect(invalidated).toEqual(
      expect.arrayContaining([
        sendersKeys.all,
        activityKeys.all,
        TRIAGE_QUEUE_KEY,
        SCREENER_QUEUE_KEY,
      ]),
    );
  });

  it('emits sender_unprotected only when told the unprotect context', async () => {
    const client = createTestQueryClient();
    const { result } = renderHook(() => useSetSenderPolicy(), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    act(() => {
      result.current.mutate({
        senderId: 's1',
        patch: { isProtected: false },
        unprotect: { surface: 'settings-senders', reason: 'starred' },
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(trackSpy).toHaveBeenCalledExactlyOnceWith('sender_unprotected', {
      surface: 'settings-senders',
      reason: 'starred',
    });
  });

  it('emits nothing for a Protect-ON or a keep-policy write', async () => {
    const client = createTestQueryClient();
    const { result } = renderHook(() => useSetSenderPolicy(), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    act(() => {
      result.current.mutate({ senderId: 's1', patch: { isProtected: true } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(trackSpy).not.toHaveBeenCalled();
  });
});
