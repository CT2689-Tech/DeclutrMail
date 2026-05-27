/**
 * Senders feature — Zustand client-state slice (D200, D49).
 *
 * Per D200's boundary: server data (the senders list, hero slices)
 * lives in TanStack Query; ephemeral client-only flags live here.
 *
 * Currently owns one piece of state: the per-session view toggle for
 * grid vs table (D49 — "Always grid; table is per-session toggle").
 * D49 explicitly says the toggle does NOT persist across sessions —
 * each page visit starts in grid. The store is in-memory only; no
 * `persist` middleware on purpose.
 *
 * Why a Zustand store for a single flag? Because the toggle button
 * (top-right of the screen) is rendered separately from the body
 * (which switches between Grid and Table). Drilling props through the
 * subtree, or hoisting useState, would tie the toggle's lifetime to
 * the parent SendersScreen — fine for now, but the moment a sibling
 * surface (the hero CTA, a settings panel, a keyboard shortcut)
 * wants to read or set the toggle, prop drilling becomes the wrong
 * pattern. Following the triage feature's store pattern (D200).
 */

'use client';

import { create } from 'zustand';

/** Two-value view enum — grid is the default; table is the opt-in (D49). */
export type SendersView = 'grid' | 'table';

export interface SendersState {
  /** Active view — `'grid'` on mount (D49); flipped via `setView`. */
  view: SendersView;
  /** Imperative setter — toggle and direct-set both go through here. */
  setView: (view: SendersView) => void;
}

export const useSendersStore = create<SendersState>((set) => ({
  view: 'grid',
  setView: (view) => set({ view }),
}));
