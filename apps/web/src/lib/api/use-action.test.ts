/**
 * Tests for the action-poll cadence policy (D226).
 *
 * `actionRefetchInterval` is the pure brain of `useActionStatus`'s polling
 * — tested directly so we don't race real timers: poll while in flight,
 * stop the moment the worker reports a terminal state.
 */

import { createElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { actionRefetchInterval, ACTION_POLL_MS, useRecordUnsubscribeIntent } from './use-action';
import type { ActionStatusResult } from '@/lib/api/actions';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient } from '@/test/query-wrapper';

function status(s: ActionStatusResult['status']): ActionStatusResult {
  return {
    actionId: 'a-1',
    status: s,
    requestedCount: 1,
    affectedCount: 1,
    undoToken: s === 'done' ? 'tok-1' : null,
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
