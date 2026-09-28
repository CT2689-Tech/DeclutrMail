/**
 * Senders feature — Zustand client-state slice (D200).
 *
 * Per D200's boundary: server data (the senders list) lives in TanStack
 * Query; ephemeral client-only flags live here.
 *
 * Owns the list sort column + direction (ADR-0014). Deliberately NOT
 * persisted — a stale sort would silently reorder the list on a later
 * visit. The URL is the durable copy (`useComposeState`).
 *
 * Why a store for two fields? The Sort menu sits in the header and the
 * saved-views save path reads the sort from a sibling callback; drilling
 * it would tie both to the screen's render tree. Follows the triage
 * feature's store pattern (D200).
 */

'use client';

import { create } from 'zustand';

import type { SenderListDirection, SenderListSort } from '@/lib/api/senders';

export interface SendersState {
  /** Active sort column. Mirrors the server contract; `'total'` is the default. */
  sort: SenderListSort;
  /** Active sort direction — `'desc'` for total (default). */
  direction: SenderListDirection;
  setSort: (next: { sort: SenderListSort; direction: SenderListDirection }) => void;
}

export const useSendersStore = create<SendersState>((set) => ({
  sort: 'total',
  direction: 'desc',
  setSort: ({ sort, direction }) => set({ sort, direction }),
}));
