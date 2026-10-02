import { afterEach, describe, expect, it } from 'vitest';
import { QueryObserver } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import { SCREENER_QUEUE_KEY } from '@/features/screener/api/query-keys';
import { TRIAGE_BOOTSTRAP_KEY } from '@/features/triage/api/query-keys';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { useRevertActivity } from './use-activity';

afterEach(() => resetFetchStub());

describe('Activity Undo queue reconciliation', () => {
  it.each(['done', 'failed'] as const)(
    'refreshes fresh Triage and Screener queues after the reverse job ends %s',
    async (status) => {
      const client = createTestQueryClient();
      const queueKeys = [TRIAGE_BOOTSTRAP_KEY, SCREENER_QUEUE_KEY] as const;
      const unsubscribe: Array<() => void> = [];
      let restoredSenders = 0;
      let undoRequests = 0;
      let statusRequests = 0;

      // A failed provider job can still have restored a subset. Both
      // outcomes must replace fresh queue snapshots, without waiting for
      // staleTime or a window-focus refetch.
      for (const queryKey of queueKeys) {
        const queryFn = async () => ({ restoredSenders });
        await client.fetchQuery({ queryKey, queryFn, staleTime: Infinity });
        const observer = new QueryObserver(client, {
          queryKey,
          queryFn,
          staleTime: Infinity,
        });
        unsubscribe.push(observer.subscribe(() => undefined));
      }

      installFetchStub([
        {
          method: 'POST',
          path: '/api/undo/undo-token/action',
          respond: () => {
            undoRequests += 1;
            return jsonOk({ data: { reverted: false, actionId: 'reverse-action' } });
          },
        },
        {
          method: 'GET',
          path: '/api/actions/reverse-action',
          respond: () => {
            statusRequests += 1;
            restoredSenders = 1;
            return jsonOk({
              data: {
                status,
                undoRevertedAt: status === 'done' ? '2026-10-02T12:00:00Z' : null,
              },
            });
          },
        },
      ]);

      const { result, unmount } = renderHook(() => useRevertActivity(), {
        wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
      });
      try {
        for (const queryKey of queueKeys) {
          expect(client.getQueryData(queryKey)).toEqual({ restoredSenders: 0 });
        }
        act(() => result.current.mutate('undo-token'));
        await waitFor(() => {
          expect(status === 'done' ? result.current.isSuccess : result.current.isError).toBe(true);
        });
        await waitFor(() => {
          for (const queryKey of queueKeys) {
            expect(client.getQueryData(queryKey)).toEqual({ restoredSenders: 1 });
          }
        });
        expect(undoRequests).toBe(1);
        expect(statusRequests).toBe(1);
      } finally {
        unsubscribe.forEach((stop) => stop());
        unmount();
        client.clear();
      }
    },
  );
});
