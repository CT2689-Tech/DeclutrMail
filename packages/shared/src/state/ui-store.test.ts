// Tests for the D200 example client-only Zustand store.
//
// Zustand exposes `getState`/`setState` outside React, so we can test
// the reducer surface without a renderer. Each test resets state
// first so order doesn't matter and parallel runs stay isolated.

import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from './ui-store';

describe('useUiStore — D200 cross-feature UI flags', () => {
  beforeEach(() => {
    useUiStore.setState({
      commandPaletteOpen: false,
      screenHelp: null,
    });
  });

  it('defaults to a closed palette and no screen help', () => {
    const state = useUiStore.getState();
    expect(state.commandPaletteOpen).toBe(false);
    expect(state.screenHelp).toBeNull();
  });

  it('opens, closes, and toggles the command palette', () => {
    useUiStore.getState().openCommandPalette();
    expect(useUiStore.getState().commandPaletteOpen).toBe(true);

    useUiStore.getState().closeCommandPalette();
    expect(useUiStore.getState().commandPaletteOpen).toBe(false);

    useUiStore.getState().toggleCommandPalette();
    expect(useUiStore.getState().commandPaletteOpen).toBe(true);
    useUiStore.getState().toggleCommandPalette();
    expect(useUiStore.getState().commandPaletteOpen).toBe(false);
  });

  it('registers screen help and clears it only for the owning screen', () => {
    const { setScreenHelp, clearScreenHelp } = useUiStore.getState();
    expect(useUiStore.getState().screenHelp).toBeNull();

    setScreenHelp({ id: 'senders', title: 'Senders', body: 'Review senders.' });
    // The next route registers before the previous one's cleanup runs.
    setScreenHelp({ id: 'triage', title: 'Triage', body: 'Make a decision.' });
    clearScreenHelp('senders');
    expect(useUiStore.getState().screenHelp?.id).toBe('triage');

    clearScreenHelp('triage');
    expect(useUiStore.getState().screenHelp).toBeNull();
  });
});
