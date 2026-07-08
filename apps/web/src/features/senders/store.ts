/**
 * Senders feature — Zustand client-state slice (D200, D49).
 *
 * Per D200's boundary: server data (the senders list, hero slices)
 * lives in TanStack Query; ephemeral client-only flags live here.
 *
 * Owns two pieces of client state:
 *   - the per-session grid/table `view` toggle (D49), and
 *   - the list sort column + direction (ADR-0014).
 *
 * D49 explicitly says the toggle does NOT persist across sessions —
 * each page visit starts in grid. The store is in-memory only; no
 * `persist` middleware on purpose. The grid is the default surface
 * (D49 + the ADR-0018 mobile dialect); the flat sortable table is the
 * opt-in the segmented control flips to.
 *
 * Why a Zustand store for these flags? The toggle button (top of the
 * screen) is rendered separately from the body (which switches between
 * Grid and Table), and the sort chip lives in the ComposeStrip — a
 * sibling surface. Drilling props through the subtree would tie their
 * lifetime to the parent SendersScreen. Following the triage feature's
 * store pattern (D200).
 */

'use client';

import { create } from 'zustand';

import type { SenderListDirection, SenderListSort } from '@/lib/api/senders';

/** Two-value view enum — grid is the default; table is the opt-in (D49). */
export type SendersView = 'grid' | 'table';

export interface SendersState {
  /** Active view — `'grid'` on mount (D49); flipped via `setView`. */
  view: SendersView;
  /** Imperative setter — toggle and direct-set both go through here. */
  setView: (view: SendersView) => void;
  /**
   * Active sort column. Mirrors the server contract: `'total'` is the
   * Slice 1 product default. Stored here so sibling surfaces (the
   * ComposeStrip sort chip, the SenderTable header click, a future
   * keyboard shortcut) can read/set it without prop-drilling through
   * the screen tree.
   */
  sort: SenderListSort;
  /** Active sort direction — `'desc'` for total (default). */
  direction: SenderListDirection;
  /** Imperative setter — wires the ComposeStrip + SenderTable sort. */
  setSort: (next: { sort: SenderListSort; direction: SenderListDirection }) => void;
}

export const useSendersStore = create<SendersState>((set) => ({
  view: 'grid',
  setView: (view) => set({ view }),
  sort: 'total',
  direction: 'desc',
  setSort: ({ sort, direction }) => set({ sort, direction }),
}));
