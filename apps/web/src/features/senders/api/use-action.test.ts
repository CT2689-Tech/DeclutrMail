/**
 * Tests for the action-poll cadence policy (D226).
 *
 * `actionRefetchInterval` is the pure brain of `useActionStatus`'s polling
 * — tested directly so we don't race real timers: poll while in flight,
 * stop the moment the worker reports a terminal state.
 */

import { describe, expect, it } from 'vitest';

import { actionRefetchInterval, ACTION_POLL_MS } from './use-action';
import type { ActionStatusResult } from '@/lib/api/actions';

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
