import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, jsonNotFound, jsonOk } from '@/test/fetch-stub';
import { sendersKeys } from './api/query-keys';
import { makeSender } from './testing/make-sender';
import type { Sender } from './data';
import type { PinnedRow } from './pinned-rows';
import { usePinnedSenders } from './use-pinned-senders';

vi.mock('@/features/auth/api/use-me', () => ({ useUserTimeZone: () => 'UTC' }));

const row = makeSender({
  id: 'a',
  inboxCount: 0,
  archivedCount: 21,
  policyType: 'unsubscribe',
  unsubStatus: 'requested',
});
const pinned = new Map<string, PinnedRow<Sender>>([['a', { row, index: 0, refreshFacts: true }]]);

describe('retained sender facts', () => {
  it('re-reads a dropped sender when the later unsubscribe invalidates its detail', async () => {
    let accepted = false;
    let reads = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders/a',
        respond: () => {
          reads += 1;
          return jsonOk({
            data: {
              ...row,
              inboxCount: 0,
              archivedCount: 0,
              unsubStatus: accepted ? 'endpoint_accepted' : 'requested',
            },
          });
        },
      },
    ]);
    const client = createTestQueryClient();
    const { result } = renderHook(() => usePinnedSenders([], pinned), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });
    await waitFor(() => expect(result.current[0]?.archivedCount).toBe(0));
    accepted = true;
    await act(async () => {
      await client.invalidateQueries({ queryKey: sendersKeys.detail('a') });
    });
    await waitFor(() => expect(result.current[0]?.unsubStatus).toBe('endpoint_accepted'));
    expect(reads).toBe(2);
    expect(result.current).toHaveLength(1);
  });

  it('uses listed facts without an extra detail request, and releases rows with their scope', () => {
    const fetch = vi.fn();
    installFetchStub([{ method: 'GET', path: '/api/senders/a', respond: fetch }]);
    const client = createTestQueryClient();
    const fresh = { ...row, archivedCount: 7 };
    const { result, rerender } = renderHook(({ rows, pins }) => usePinnedSenders(rows, pins), {
      initialProps: { rows: [fresh] as Sender[], pins: pinned },
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });
    expect(result.current).toEqual([fresh]);
    expect(fetch).not.toHaveBeenCalled();
    rerender({ rows: [], pins: new Map() });
    expect(result.current).toEqual([]);
  });

  it('does not fan out detail reads for retained bulk rows', () => {
    const fetch = vi.fn();
    installFetchStub([{ method: 'GET', path: /\/api\/senders\//, respond: fetch }]);
    const client = createTestQueryClient();
    const bulk = new Map([['a', { row, index: 0 }]]);
    const { result } = renderHook(() => usePinnedSenders([], bulk), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });
    expect(result.current).toEqual([row]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refreshes again when completion invalidates an initial in-flight snapshot', async () => {
    let releaseInitial!: (response: Response) => void;
    let reads = 0;
    const initial = new Promise<Response>((resolve) => {
      releaseInitial = resolve;
    });
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders/a',
        respond: () => {
          reads += 1;
          return reads === 1
            ? initial
            : jsonOk({ data: { ...row, archivedCount: 0, unsubStatus: 'endpoint_accepted' } });
        },
      },
    ]);
    const client = createTestQueryClient();
    const { result } = renderHook(() => usePinnedSenders([], pinned), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });
    await waitFor(() => expect(reads).toBe(1));
    // This invalidation deliberately lands before the initial read returns
    // its earlier, still-requesting snapshot, matching the production race.
    void client.invalidateQueries({ queryKey: sendersKeys.detail('a') });
    await act(async () => {
      releaseInitial(jsonOk({ data: row }));
    });
    await waitFor(() => expect(result.current[0]?.unsubStatus).toBe('endpoint_accepted'), {
      timeout: 3_500,
    });
    expect(result.current[0]?.archivedCount).toBe(0);
    expect(reads).toBe(2);
  });

  it('does not call cached data current after a terminal refresh fails', async () => {
    let unreadable = false;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders/a',
        respond: () => (unreadable ? jsonNotFound() : jsonOk({ data: row })),
      },
    ]);
    const client = createTestQueryClient();
    const { result } = renderHook(() => usePinnedSenders([], pinned), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });
    await waitFor(() => expect(client.getQueryData(sendersKeys.detail('a'))).toBeDefined());
    unreadable = true;
    await act(async () => {
      await client.invalidateQueries({ queryKey: sendersKeys.detail('a') });
    });
    await waitFor(() => expect(result.current[0]?.archivedCount).toBeNull());
    expect(result.current[0]?.inboxCount).toBeNull();
    expect(result.current[0]?.unsubStatus).toBeNull();
    expect(result.current[0]?.totalReceived).toBe(row.totalReceived);
  });
});
