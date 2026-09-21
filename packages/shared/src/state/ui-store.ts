// Cross-feature transient UI flags (D200 Zustand example store).
//
// Holds ephemeral browser-only UI state that genuinely spans features
// — flags every screen reads or toggles. Per the boundary in D200:
//
//   - Server data → TanStack Query, never here.
//   - Per-feature client state → feature's own store under
//     apps/web/src/features/<feature>/store.ts.
//
// This file is the scaffold the D200 decision points at: it
// demonstrates the shape (typed state + actions, default-export-free
// named hook) for future cross-feature stores, and it owns two pieces
// of state that already span surfaces — the global command-palette open
// state, and the current screen's help (registered by `ScreenIntro`,
// read by the shell's `?` button).
//
// Nothing here persists. State that must survive a reload — the
// sidebar's icon-rail choice — uses `useLocalState` at its one call
// site (shell/app-shell.tsx) instead.

'use client';

import type { ReactNode } from 'react';
import { create } from 'zustand';

/**
 * What the top bar's `?` button shows for the screen on display. A
 * screen registers it by rendering `<ScreenIntro>`; nothing registered
 * means the button hides. Browser-only and route-scoped, so it lives
 * here rather than in any feature store.
 */
export interface ScreenHelp {
  id: string;
  title: string;
  body: ReactNode;
  tip?: ReactNode;
  learnMore?: { href: string; label: string };
}

export interface UiState {
  /** True while the kbd-launchable command palette is mounted-open. */
  commandPaletteOpen: boolean;
  /** Help for the current screen; `null` when the screen registered none. */
  screenHelp: ScreenHelp | null;
}

export interface UiActions {
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;
  setScreenHelp: (help: ScreenHelp) => void;
  /**
   * Clears only if `id` still owns the slot. On a route change the next
   * screen can register before the previous one's cleanup runs; an
   * unconditional clear would wipe the newcomer's help.
   */
  clearScreenHelp: (id: string) => void;
}

export const useUiStore = create<UiState & UiActions>((set) => ({
  commandPaletteOpen: false,
  screenHelp: null,
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  setScreenHelp: (help) => set({ screenHelp: help }),
  clearScreenHelp: (id) => set((s) => (s.screenHelp?.id === id ? { screenHelp: null } : {})),
}));
