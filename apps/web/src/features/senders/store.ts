/**
 * Senders feature — Zustand client-state slice (D200, D49).
 *
 * Per D200's boundary: server data (the senders list, hero slices)
 * lives in TanStack Query; ephemeral client-only flags live here.
 *
 * Owns the list sort state. The former grid/table `view` toggle was
 * retired (founder-approved, 2026-07-08 senders suite) — the grid is
 * the single adaptive surface (D49's default + the ADR-0018 mobile
 * dialect), so the store no longer carries a view flag.
 */

'use client';

import { create } from 'zustand';

import type { SenderListDirection, SenderListSort } from '@/lib/api/senders';

export interface SendersState {
  /**
   * Active sort column. Mirrors the server contract: `'total'` is the
   * Slice 1 product default. Stored here so sibling surfaces (the
   * ComposeStrip sort chip, a future keyboard shortcut) can read/set it
   * without prop-drilling through the screen tree.
   */
  sort: SenderListSort;
  /** Active sort direction — `'desc'` for total (default). */
  direction: SenderListDirection;
  /** Imperative setter — wires the ComposeStrip's onSortChange. */
  setSort: (next: { sort: SenderListSort; direction: SenderListDirection }) => void;
}

export const useSendersStore = create<SendersState>((set) => ({
  sort: 'total',
  direction: 'desc',
  setSort: ({ sort, direction }) => set({ sort, direction }),
}));
