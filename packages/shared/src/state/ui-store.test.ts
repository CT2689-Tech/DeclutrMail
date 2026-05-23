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
      sidebarCollapsed: false,
    });
  });

  it('defaults to closed palette and expanded sidebar', () => {
    const state = useUiStore.getState();
    expect(state.commandPaletteOpen).toBe(false);
    expect(state.sidebarCollapsed).toBe(false);
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

  it('toggles and sets the sidebar collapse', () => {
    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);

    useUiStore.getState().setSidebarCollapsed(false);
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);

    useUiStore.getState().setSidebarCollapsed(true);
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
  });
});
