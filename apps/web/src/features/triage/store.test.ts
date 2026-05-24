// Tests for the triage Zustand slice (D200 client-state pattern).
//
// Zustand exposes `getState`/`setState` outside React, so we test the
// reducer surface without a renderer — same shape as
// `packages/shared/src/state/ui-store.test.ts`. Each test calls
// `resetTriageStore()` first so order doesn't matter and parallel
// runs stay isolated.
//
// What this file locks in:
//
//   - The default remember-preference is `false` for every sheetable
//     verb — sheet shows by default (D34).
//   - Round-tripping the toggle per verb does not leak across verbs.
//   - `toggleExpandedRow` is true accordion: same id collapses,
//     different id swaps.
//   - `openPending` / `clearPending` set and clear cleanly.

import { beforeEach, describe, expect, it } from 'vitest';
import { resetTriageStore, useTriageStore, type SheetableVerb } from './store';

beforeEach(() => {
  resetTriageStore();
});

describe('useTriageStore — default state', () => {
  it('starts with no expanded row, no pending action, sheet on for every verb', () => {
    const s = useTriageStore.getState();
    expect(s.expandedRowId).toBeNull();
    expect(s.pendingAction).toBeNull();
    expect(s.rememberPreference).toEqual({
      Archive: false,
      Unsubscribe: false,
      Later: false,
    });
  });
});

describe('useTriageStore — remember-preference per verb (D34)', () => {
  const VERBS: SheetableVerb[] = ['Archive', 'Unsubscribe', 'Later'];

  for (const verb of VERBS) {
    it(`round-trips ${verb} without leaking into the other verbs`, () => {
      const { setRememberPreference } = useTriageStore.getState();

      setRememberPreference(verb, true);
      const after = useTriageStore.getState().rememberPreference;
      expect(after[verb]).toBe(true);
      // Other verbs must remain at default.
      for (const other of VERBS) {
        if (other === verb) continue;
        expect(after[other]).toBe(false);
      }

      setRememberPreference(verb, false);
      expect(useTriageStore.getState().rememberPreference[verb]).toBe(false);
    });
  }
});

describe('useTriageStore — accordion expand/collapse (D36, D198)', () => {
  it('setExpandedRow expands a row id', () => {
    useTriageStore.getState().setExpandedRow('row-1');
    expect(useTriageStore.getState().expandedRowId).toBe('row-1');
  });

  it('setExpandedRow(null) collapses any open row', () => {
    useTriageStore.getState().setExpandedRow('row-1');
    useTriageStore.getState().setExpandedRow(null);
    expect(useTriageStore.getState().expandedRowId).toBeNull();
  });

  it('toggleExpandedRow expands when collapsed', () => {
    useTriageStore.getState().toggleExpandedRow('row-1');
    expect(useTriageStore.getState().expandedRowId).toBe('row-1');
  });

  it('toggleExpandedRow collapses when the same row is already expanded', () => {
    useTriageStore.getState().toggleExpandedRow('row-1');
    useTriageStore.getState().toggleExpandedRow('row-1');
    expect(useTriageStore.getState().expandedRowId).toBeNull();
  });

  it('toggleExpandedRow swaps when a different row is requested', () => {
    useTriageStore.getState().toggleExpandedRow('row-1');
    useTriageStore.getState().toggleExpandedRow('row-2');
    expect(useTriageStore.getState().expandedRowId).toBe('row-2');
  });
});

describe('useTriageStore — pending action lifecycle (D226)', () => {
  it('openPending stores verb + rowId + surface', () => {
    useTriageStore.getState().openPending('Archive', 'row-1', 'sheet');
    const p = useTriageStore.getState().pendingAction;
    expect(p).not.toBeNull();
    expect(p?.verb).toBe('Archive');
    expect(p?.rowId).toBe('row-1');
    expect(p?.surface).toBe('sheet');
  });

  it('openPending overwrites a previous pending action (only one at a time)', () => {
    useTriageStore.getState().openPending('Archive', 'row-1', 'sheet');
    useTriageStore.getState().openPending('Unsubscribe', 'row-2', 'inline');
    const p = useTriageStore.getState().pendingAction;
    expect(p?.verb).toBe('Unsubscribe');
    expect(p?.rowId).toBe('row-2');
    expect(p?.surface).toBe('inline');
  });

  it('clearPending returns to null', () => {
    useTriageStore.getState().openPending('Archive', 'row-1', 'sheet');
    useTriageStore.getState().clearPending();
    expect(useTriageStore.getState().pendingAction).toBeNull();
  });
});
