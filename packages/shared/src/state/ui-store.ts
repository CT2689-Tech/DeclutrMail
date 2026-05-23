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
// named hook) for future cross-feature stores, and it owns two flags
// that already span surfaces — the global command-palette open state
// and the sidebar collapse state (the sidebar lives in
// packages/shared/src/shell/sidebar.tsx and is rendered on every
// authenticated route).
//
// Persistence note: persisting the sidebar collapse to localStorage is
// a future improvement once the persist middleware is wired. The
// existing `useLocalState` hook already handles a single boolean if a
// component wants survival today; keeping persistence opt-in avoids
// hydration warnings until we've validated the SSR story.

'use client';

import { create } from 'zustand';

export interface UiState {
  /** True while the kbd-launchable command palette is mounted-open. */
  commandPaletteOpen: boolean;
  /** True iff the sidebar is collapsed to its narrow rail. */
  sidebarCollapsed: boolean;
}

export interface UiActions {
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState & UiActions>((set) => ({
  commandPaletteOpen: false,
  sidebarCollapsed: false,
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
