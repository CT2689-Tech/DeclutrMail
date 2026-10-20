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
  it.each([0, 7])(
    'removes a completed sender only when its fresh remaining count is zero (%i)',
    async (remaining) => {
      installFetchStub([
        {
          method: 'GET',
          path: '/api/senders/a',
          respond: () =>
            jsonOk({
              data: {
                ...row,
                inboxCount: 0,
                archivedCount: remaining,
              },
            }),
        },
      ]);
      const client = createTestQueryClient();
      const completed = new Set(['a']);
      const completedPins = new Map([['a', { row, index: 0, refreshFacts: true, completedAt: 1 }]]);
      const { result } = renderHook(() => usePinnedSenders([], completedPins, completed), {
        wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
      });
      await waitFor(() =>
        expect(client.getQueryState([...sendersKeys.detail('a'), 'cleanup', 1])?.status).toBe(
          'success',
        ),
      );
      await waitFor(() => expect(result.current).toHaveLength(remaining === 0 ? 0 : 1));
      if (remaining > 0) expect(result.current[0]?.archivedCount).toBe(remaining);
    },
  );

  it.each(['remaining', 'error'])(
    'keeps cached zero counts until a post-completion read confirms them (%s)',
    async (outcome) => {
      let finish!: (response: Response) => void;
      const fresh = new Promise<Response>((resolve) => {
        finish = resolve;
      });
      installFetchStub([{ method: 'GET', path: '/api/senders/a', respond: () => fresh }]);
      const client = createTestQueryClient();
      client.setQueryData(sendersKeys.detail('a'), {
        data: { ...row, inboxCount: 0, archivedCount: 0 },
      });
      const completed = new Set(['a']);
      const completedPins = new Map([
        [
          'a',
          {
            row: { ...row, inboxCount: 0, archivedCount: 0 },
            index: 0,
            refreshFacts: true,
            completedAt: Date.now(),
          },
        ],
      ]);
      const { result } = renderHook(() => usePinnedSenders([], completedPins, completed), {
        wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
      });
      expect(result.current).toHaveLength(1);
      await act(async () =>
        finish(
          outcome === 'error'
            ? jsonNotFound()
            : jsonOk({ data: { ...row, inboxCount: 0, archivedCount: 7 } }),
        ),
      );
      await waitFor(() =>
        expect(result.current[0]?.archivedCount).toBe(outcome === 'error' ? null : 7),
      );
      expect(result.current).toHaveLength(1);
    },
  );

  it('keeps zero-count rows while their action result is still unconfirmed', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders/a',
        respond: () =>
          jsonOk({
            data: {
              ...row,
              inboxCount: 0,
              archivedCount: 0,
            },
          }),
      },
    ]);
    const client = createTestQueryClient();
    const { result } = renderHook(() => usePinnedSenders([], pinned, new Set()), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });
    await waitFor(() => expect(result.current[0]?.archivedCount).toBe(0));
    expect(result.current).toHaveLength(1);
  });

  it('shows restored or newly received current mail after a completed row disappeared', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders/a',
        respond: () =>
          jsonOk({
            data: {
              ...row,
              inboxCount: 0,
              archivedCount: 0,
            },
          }),
      },
    ]);
    const client = createTestQueryClient();
    const completed = new Set(['a']);
    const completedPins = new Map([['a', { row, index: 0, refreshFacts: true, completedAt: 1 }]]);
    const { result, rerender } = renderHook(
      ({ rows }) => usePinnedSenders(rows, completedPins, completed),
      {
        initialProps: { rows: [] as Sender[] },
        wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
      },
    );
    await waitFor(() => expect(result.current).toHaveLength(0));
    rerender({ rows: [{ ...row, inboxCount: 0, archivedCount: 21 }] });
    expect(result.current).toHaveLength(1);
    expect(result.current[0]?.archivedCount).toBe(21);
  });

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

  it('does not poll a hidden zero row while unsubscribe is still requested', async () => {
    vi.useFakeTimers();
    try {
      let reads = 0;
      installFetchStub([
        {
          method: 'GET',
          path: '/api/senders/a',
          respond: () => {
            reads += 1;
            return jsonOk({
              data: { ...row, inboxCount: 0, archivedCount: 0, unsubStatus: 'requested' },
            });
          },
        },
      ]);
      const client = createTestQueryClient();
      const completedPins = new Map([['a', { row, index: 0, refreshFacts: true, completedAt: 1 }]]);
      const { result } = renderHook(() => usePinnedSenders([], completedPins, new Set(['a'])), {
        wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(result.current).toHaveLength(0);
      const afterHide = reads;
      expect(afterHide).toBeGreaterThan(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(reads).toBe(afterHide);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the pin when the detail envelope has no sender payload', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders/a',
        // `{ data: null }` is a real envelope. A body with no `data` key
        // never reaches the query — the client throws before that.
        respond: () => jsonOk({ data: null }),
      },
    ]);
    const client = createTestQueryClient();
    const { result } = renderHook(() => usePinnedSenders([], pinned, new Set()), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });
    await waitFor(() =>
      expect(client.getQueryState(sendersKeys.detail('a'))?.status).toBe('success'),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0]?.id).toBe('a');
    expect(result.current[0]?.unsubStatus).toBe(row.unsubStatus);
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
    const completed = new Set(['a']);
    const { result } = renderHook(() => usePinnedSenders([], pinned, completed), {
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
    expect(result.current).toHaveLength(1);
  });
});
