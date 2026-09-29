import { createElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InFlightActionGroup } from '@/lib/api/actions';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient } from '@/test/query-wrapper';

import { HOLD_RECHECK_MS, HOLD_SETTLE_MS, useUnconfirmedHolds } from './unconfirmed-holds';

const RUNNING: InFlightActionGroup = {
  groupId: 'group-1',
  verb: 'archive',
  mixedVerbs: false,
  running: true,
  total: 1,
  done: 0,
  failed: 0,
  senderCount: 1,
  leadSenderName: 'Acme',
  startedAt: '2026-09-27T00:00:00.000Z',
};

function setup(listed: readonly string[], active: () => InFlightActionGroup[]) {
  installFetchStub([
    { method: 'GET', path: '/api/actions/active', respond: () => jsonOk({ data: active() }) },
  ]);
  const client = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return renderHook(({ ids }) => useUnconfirmedHolds<'Archive'>('mailbox-a', ids), {
    wrapper,
    initialProps: { ids: listed },
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useUnconfirmedHolds', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetFetchStub();
  });

  it('releases a row once a list read no longer shows it, so it is free when it returns', async () => {
    const hook = setup(['a', 'b'], () => [RUNNING]);
    act(() => hook.result.current.hold(['a'], 'Archive'));
    expect(hook.result.current.held.get('a')?.verb).toBe('Archive');

    hook.rerender({ ids: ['b'] });
    expect(hook.result.current.held.has('a')).toBe(false);
    // Undo put the sender back: nothing is running for it any more.
    hook.rerender({ ids: ['a', 'b'] });
    expect(hook.result.current.held.has('a')).toBe(false);
  });

  it('keeps holding while the in-flight list shows work running', async () => {
    const hook = setup(['a'], () => [RUNNING]);
    await advance(0);
    act(() => hook.result.current.hold(['a'], 'Archive'));

    await advance(HOLD_SETTLE_MS * 4);
    expect(hook.result.current.held.has('a')).toBe(true);
  });

  it('releases every hold after two quiet reads spaced after the latest hold', async () => {
    const hook = setup(['a', 'b'], () => []);
    await advance(0);
    act(() => hook.result.current.hold(['a', 'b'], 'Archive'));

    await advance(HOLD_SETTLE_MS * 2 - HOLD_RECHECK_MS);
    expect(hook.result.current.held.size).toBe(2);
    // The read due at twice the settle time can land a tick late.
    await advance(HOLD_RECHECK_MS * 2);
    expect(hook.result.current.held.size).toBe(0);
  });

  it('restarts the quiet clock on a new hold', async () => {
    const hook = setup(['a', 'b'], () => []);
    await advance(0);
    act(() => hook.result.current.hold(['a'], 'Archive'));
    await advance(HOLD_SETTLE_MS + HOLD_RECHECK_MS);
    act(() => hook.result.current.hold(['b'], 'Archive'));

    await advance(HOLD_SETTLE_MS * 2 - HOLD_RECHECK_MS);
    expect(hook.result.current.held.size).toBe(2);
    await advance(HOLD_RECHECK_MS * 2);
    expect(hook.result.current.held.size).toBe(0);
  });
});
