// The Screener's state composition (D200 + the D211 error leg).
//
// A background re-read that fails must not take a loaded queue — and the
// row the user has open — off the screen. TanStack keeps the last data
// when a refetch rejects; the error screen is for when there is nothing
// to draw. Explanations on demand made those re-reads routine: an opened
// row's reason is re-read until its sentence lands.

import { describe, expect, it } from 'vitest';
import { composeScreenerState } from './compose-state';
import { SCREENER_QUEUE } from './data';

const base = {
  rows: undefined,
  isLoading: false,
  isError: false,
  error: null,
  retry: () => {},
};

describe('composeScreenerState', () => {
  it('keeps a loaded queue on screen when a re-read fails', () => {
    const state = composeScreenerState({
      ...base,
      rows: [...SCREENER_QUEUE],
      isError: true,
      error: new Error('429'),
    });
    expect(state.kind).toBe('ready');
  });

  it('shows the error when the first load fails — there is nothing to draw', () => {
    const err = new Error('boom');
    const state = composeScreenerState({ ...base, isError: true, error: err });
    expect(state.kind).toBe('error');
    if (state.kind === 'error') expect(state.error).toBe(err);
  });
});
