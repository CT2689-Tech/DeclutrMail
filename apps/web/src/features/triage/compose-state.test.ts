// Tests for the triage state composition (D200 + the D211 error leg).
//
// The load-bearing case is the error branch ordering: a failed query
// has `isLoading=false` + `data=undefined`, which the old loading-first
// composition rendered as a skeleton forever (launch-gap audit row
// "Triage route error state — missing").

import { describe, expect, it } from 'vitest';
import { composeTriageState } from './compose-state';
import { TRIAGE_QUEUE, TRIAGE_SESSION_STATS } from './data';

const base = {
  rows: undefined,
  stats: undefined,
  isLoading: false,
  isError: false,
  error: null,
  retry: () => {},
};

describe('composeTriageState', () => {
  it('error wins over everything — even while a sibling query is loading', () => {
    const err = new Error('boom');
    const state = composeTriageState({ ...base, isLoading: true, isError: true, error: err });
    expect(state.kind).toBe('error');
    if (state.kind === 'error') {
      expect(state.error).toBe(err);
    }
  });

  it('a failed query with isLoading=false is error, NOT loading (the skeleton-forever bug)', () => {
    const state = composeTriageState({ ...base, isError: true, error: new Error('500') });
    expect(state.kind).toBe('error');
  });

  it('loading while either query is in flight', () => {
    expect(composeTriageState({ ...base, isLoading: true }).kind).toBe('loading');
  });

  it('loading while stats are missing even if rows resolved', () => {
    expect(composeTriageState({ ...base, rows: [...TRIAGE_QUEUE] }).kind).toBe('loading');
  });

  it('empty when stats resolved and rows are empty', () => {
    const state = composeTriageState({ ...base, rows: [], stats: TRIAGE_SESSION_STATS });
    expect(state.kind).toBe('empty');
  });

  it('ready with rows + stats', () => {
    const state = composeTriageState({
      ...base,
      rows: [...TRIAGE_QUEUE],
      stats: TRIAGE_SESSION_STATS,
    });
    expect(state.kind).toBe('ready');
    if (state.kind === 'ready') {
      expect(state.rows).toHaveLength(TRIAGE_QUEUE.length);
    }
  });

  it('retry callback is carried through to the error state', () => {
    let called = 0;
    const state = composeTriageState({
      ...base,
      isError: true,
      error: new Error('x'),
      retry: () => {
        called += 1;
      },
    });
    if (state.kind === 'error') state.retry();
    expect(called).toBe(1);
  });
});
