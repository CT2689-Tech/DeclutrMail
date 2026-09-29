/**
 * Tests for the action-poll cadence policy (D226).
 *
 * `actionRefetchInterval` is the pure brain of `useActionStatus`'s polling
 * — tested directly so we don't race real timers: poll while in flight,
 * stop the moment the worker reports a terminal state.
 */

import { createElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendersKeys } from '@/features/senders/api/query-keys';
import { activityKeys } from '@/features/activity/api/query-keys';
import { undoKeys } from '@/features/undo/query-keys';
import type { ActionStatusResult } from '@/lib/api/actions';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient } from '@/test/query-wrapper';

import {
  actionRefetchInterval,
  ACTION_POLL_MS,
  useActionStatus,
  useBatchStatus,
  useRecordUnsubscribeIntent,
  useCompositePreview,
  useBulkActionPreview,
} from './use-action';

describe('mandatory action previews', () => {
  afterEach(() => resetFetchStub());

  it('pins single and bulk preview requests to the mailbox shown in the UI', async () => {
    const requests: Array<{ path: string; mailboxId: string | null }> = [];
    installFetchStub([
      {
        method: 'GET',
        path: '/api/actions/preview',
        respond: (req, url) => {
          requests.push({ path: url.pathname, mailboxId: req.headers.get('X-Active-Mailbox-Id') });
          return jsonOk({ data: { senderId: 'sender-a', counts: {} } });
        },
      },
      {
        method: 'POST',
        path: '/api/actions/preview/bulk',
        respond: (req, url) => {
          requests.push({ path: url.pathname, mailboxId: req.headers.get('X-Active-Mailbox-Id') });
          return jsonOk({ data: { senders: [], totals: {}, protectedCount: 0 } });
        },
      },
    ]);
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);

    const single = renderHook(() => useCompositePreview('sender-a', 'mailbox-a'), { wrapper });
    const bulk = renderHook(() => useBulkActionPreview(['sender-a', 'sender-b'], 'mailbox-a'), {
      wrapper,
    });
    await waitFor(() =>
      expect(single.result.current.isSuccess && bulk.result.current.isSuccess).toBe(true),
    );
    expect(requests).toEqual([
      { path: '/api/actions/preview', mailboxId: 'mailbox-a' },
      { path: '/api/actions/preview/bulk', mailboxId: 'mailbox-a' },
    ]);
  });
});

function status(s: ActionStatusResult['status']): ActionStatusResult {
  return {
    actionId: 'a-1',
    verb: 'archive',
    direction: 'forward',
    status: s,
    requestedCount: 1,
    affectedCount: 1,
    wakeAt: null,
    undoToken: s === 'done' ? 'tok-1' : null,
    undoExpiresAt: null,
    undoExecutedAt: null,
    undoRevertedAt: null,
    errorCode: null,
  };
}

describe('actionRefetchInterval', () => {
  it('polls before the first result', () => {
    expect(actionRefetchInterval(undefined)).toBe(ACTION_POLL_MS);
  });

  it('keeps polling while queued / executing', () => {
    expect(actionRefetchInterval(status('queued'))).toBe(ACTION_POLL_MS);
    expect(actionRefetchInterval(status('executing'))).toBe(ACTION_POLL_MS);
  });

  it('stops polling on a terminal state', () => {
    expect(actionRefetchInterval(status('done'))).toBe(false);
    expect(actionRefetchInterval(status('failed'))).toBe(false);
  });

  // `!data` covers BOTH "not loaded yet" and "errored", so an errored
  // poll kept re-issuing at 1s — and with `refetchIntervalInBackground`
  // on, in background tabs too. It did not storm only because all five
  // consuming surfaces independently clear their latch on `isError`;
  // that is convention holding a guarantee that belongs in the policy,
  // and one new consumer omitting the clear would reopen it
  // (audit 2026-08-21).
  it('stops polling when the query is in error, not just when it is terminal', () => {
    expect(actionRefetchInterval(undefined, true)).toBe(false);
    expect(actionRefetchInterval(status('executing'), true)).toBe(false);
  });
});

describe('terminal action invalidation', () => {
  afterEach(() => {
    resetFetchStub();
    vi.restoreAllMocks();
  });

  it('invalidates the global undo root when a single action becomes terminal', async () => {
    const mailboxHeaders: Array<string | null> = [];
    installFetchStub([
      {
        method: 'GET',
        path: '/api/actions/a-1',
        respond: (req) => {
          mailboxHeaders.push(req.headers.get('x-active-mailbox-id'));
          return jsonOk({ data: status('done') });
        },
      },
    ]);
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);

    const { result } = renderHook(() => useActionStatus('a-1', 'mailbox-a'), { wrapper });

    await waitFor(() => expect(result.current.data?.status).toBe('done'));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: undoKeys.all }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: sendersKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: activityKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['composite-preview'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['bulk-action-preview'] });
    expect(mailboxHeaders).toEqual(['mailbox-a']);
  });

  it('pins the batch mailbox and invalidates the undo root when it becomes terminal', async () => {
    const mailboxHeaders: Array<string | null> = [];
    installFetchStub([
      {
        method: 'GET',
        path: '/api/actions/batch/b-1',
        respond: (req) => {
          mailboxHeaders.push(req.headers.get('X-Active-Mailbox-Id'));
          return jsonOk({
            data: {
              batchId: 'b-1',
              status: 'failed',
              total: 2,
              done: 1,
              failed: 1,
              requestedCount: 2,
              affectedCount: 1,
              undoToken: null,
            },
          });
        },
      },
    ]);
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);

    const { result } = renderHook(() => useBatchStatus('b-1', 'mailbox-a'), { wrapper });

    await waitFor(() => expect(result.current.data?.status).toBe('failed'));
    expect(mailboxHeaders).toEqual(['mailbox-a']);
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: undoKeys.all }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: sendersKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: activityKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['composite-preview'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['bulk-action-preview'] });
  });
});

describe('useRecordUnsubscribeIntent', () => {
  afterEach(() => resetFetchStub());

  it('forwards includesBacklogAction through the mutation variables', async () => {
    let observedBody: unknown = null;
    installFetchStub([
      {
        method: 'POST',
        path: '/api/actions/unsubscribe-intent',
        respond: async (req) => {
          observedBody = await req.json();
          return jsonOk({
            data: {
              senderId: 'sender-1',
              recordedAt: '2026-07-12T00:00:00.000Z',
              activityLogId: 'activity-1',
              method: 'none',
              executionActionId: null,
              mailtoUrl: null,
            },
          });
        },
      },
    ]);
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => useRecordUnsubscribeIntent(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        senderId: 'sender-1',
        includesBacklogAction: true,
      });
    });

    expect(observedBody).toEqual({ senderId: 'sender-1', includesBacklogAction: true });
  });
});
