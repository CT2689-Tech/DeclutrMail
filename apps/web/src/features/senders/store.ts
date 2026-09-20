/**
 * Senders feature — Zustand client-state slice (D200, D49).
 *
 * Per D200's boundary: server data (the senders list, hero slices)
 * lives in TanStack Query; ephemeral client-only flags live here.
 *
 * Owns two pieces of client state:
 *   - the grid/table `view` toggle + table density (D49), and
 *   - the list sort column + direction (ADR-0014).
 *
 * The LAYOUT (view + density) is a per-device preference and survives a
 * page load via `localStorage` (founder decision 2026-09-20, overriding
 * D49's original "each visit starts in grid": a refresh or a
 * back/forward load threw table users back to the grid mid-cleanup).
 * The grid stays the default for a device that never chose (D49 + the
 * ADR-0018 mobile dialect). The sort is deliberately NOT persisted — a
 * stale sort would silently reorder the list on a later visit.
 *
 * The server render and the first client render both use the grid
 * default; `SendersScreen` calls `restoreSendersLayout` in a mount effect
 * — reading storage during render would be a hydration mismatch.
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

/** Table row padding — Gmail's own vocabulary (Comfortable/Compact). */
export type SendersDensity = 'comfortable' | 'compact';

export interface SendersState {
  /** Active view — `'grid'` until this device chooses otherwise (D49). */
  view: SendersView;
  /** Imperative setter — toggle and direct-set both go through here. */
  setView: (view: SendersView) => void;
  /**
   * Table density — persisted with `view` as one layout preference.
   * Only the table reads it; the grid has one density.
   */
  density: SendersDensity;
  setDensity: (density: SendersDensity) => void;
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

export const SENDERS_LAYOUT_STORAGE_KEY = 'dm-senders-layout';

type SendersLayout = Pick<SendersState, 'view' | 'density'>;

/**
 * Hand-rolled rather than `zustand/middleware` persist: the middleware
 * measured +1.2 kB gzipped on `/senders`, a route within ~2 kB of its
 * bundle budget, for what is two fields and one key.
 *
 * Storage can be unavailable or throw (private windows, blocked site
 * data), and it is user-editable and outlives deploys — so every access
 * is guarded and only values this build knows are accepted.
 */
function writeLayout(layout: SendersLayout): void {
  try {
    localStorage.setItem(SENDERS_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Not remembered on this device; the in-memory choice still holds.
  }
}

function readLayout(): Partial<SendersLayout> {
  try {
    const raw = localStorage.getItem(SENDERS_LAYOUT_STORAGE_KEY);
    const stored = (raw === null ? {} : JSON.parse(raw)) as { view?: unknown; density?: unknown };
    return {
      ...(stored.view === 'grid' || stored.view === 'table' ? { view: stored.view } : {}),
      ...(stored.density === 'comfortable' || stored.density === 'compact'
        ? { density: stored.density }
        : {}),
    };
  } catch {
    return {};
  }
}

export const useSendersStore = create<SendersState>((set, get) => ({
  view: 'grid',
  setView: (view) => {
    set({ view });
    writeLayout({ view, density: get().density });
  },
  density: 'comfortable',
  setDensity: (density) => {
    set({ density });
    writeLayout({ view: get().view, density });
  },
  sort: 'total',
  direction: 'desc',
  setSort: ({ sort, direction }) => set({ sort, direction }),
}));

/**
 * Apply this device's remembered layout. Called from a mount effect, never
 * during render: the server render and the first client render must agree
 * on the grid default or hydration mismatches.
 */
export function restoreSendersLayout(): void {
  useSendersStore.setState(readLayout());
}
