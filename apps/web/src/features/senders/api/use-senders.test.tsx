/**
 * Tests for `useSenders` — the paginated list hook.
 *
 * Verifies the initial load, the error branch, and that
 * `fetchNextPage` correctly forwards the previously-issued cursor.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSenders } from './use-senders';
import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

const ROW_A = {
  id: 'a',
  displayName: 'Sender A',
  email: 'a@example.com',
  domain: 'example.com',
  gmailCategory: 'promotions' as const,
  lastSeenAt: '2026-05-23T00:00:00.000Z',
  firstSeenAt: '2025-01-01T00:00:00.000Z',
  monthlyVolume: 30,
  readRate: 0,
  unsubscribeMethod: 'one_click' as const,
};

const ROW_B = { ...ROW_A, id: 'b', displayName: 'Sender B', email: 'b@example.com' };

describe('useSenders', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('returns the first page on initial load', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [ROW_A, ROW_B],
            meta: { pagination: { nextCursor: 'cursor-2', hasMore: true, limit: 25 } },
          }),
      },
    ]);

    const client = createTestQueryClient();
    const { result } = renderHook(() => useSenders(), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages).toHaveLength(1);
    expect(result.current.data?.pages[0]?.data).toHaveLength(2);
    expect(result.current.hasNextPage).toBe(true);
  });

  it('exposes the error when the server returns 500', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: () => jsonServerError('boom'),
      },
    ]);

    const client = createTestQueryClient();
    const { result } = renderHook(() => useSenders(), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
  });

  it('forwards the previously-issued cursor on fetchNextPage', async () => {
    const observedCursors: string[] = [];
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: (_req, url) => {
          observedCursors.push(url.searchParams.get('cursor') ?? '');
          const cursor = url.searchParams.get('cursor');
          if (!cursor) {
            return jsonOk({
              data: [ROW_A],
              meta: { pagination: { nextCursor: 'p2', hasMore: true, limit: 25 } },
            });
          }
          return jsonOk({
            data: [ROW_B],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 25 } },
          });
        },
      },
    ]);

    const client = createTestQueryClient();
    const { result } = renderHook(() => useSenders(), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    // Trigger the second page and await both the fetch resolving AND
    // the hook re-rendering with the new pages.
    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.isFetchingNextPage).toBe(false));

    expect(observedCursors).toEqual(['', 'p2']);
    expect(result.current.data?.pages).toHaveLength(2);
    expect(result.current.hasNextPage).toBe(false);
  });
});
