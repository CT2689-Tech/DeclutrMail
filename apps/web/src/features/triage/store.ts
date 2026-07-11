/**
 * Triage feature — Zustand client-state slice (D200).
 *
 * Per D200's boundary: server data (the queue itself, undo journal,
 * sender details) lives in TanStack Query; ephemeral client-only flags
 * live in feature-local stores like this one. Cross-feature flags live
 * in `packages/shared/src/state/ui-store.ts`.
 *
 * What this store owns:
 *
 *   - `rememberPreference`: per-verb toggle for D34 "always show the
 *     action sheet on Archive / Unsubscribe / Later" vs the
 *     remember-preference path. When `true` the sheet is suppressed
 *     and the row's inline preview becomes the mandatory preview
 *     surface (D226 — preview is non-skippable; only the sheet is).
 *
 *   - `expandedRowId`: which queue row is currently expanded. Hoisted
 *     from `useExpandableRow` so the action-sheet flow and the
 *     keyboard handler can both read it (the toolbar needs to know
 *     which row is focused to dispatch a verb to it).
 *
 *   - `pendingAction`: the in-flight action awaiting preview-confirm.
 *     `null` means no sheet is mounted; otherwise the sheet renders
 *     and intercepts Enter/Escape.
 *
 * Why feature-local: the triage flow doesn't share state with other
 * features (the senders feature has its own sheet flow that lives
 * inside `senders-screen.tsx`). Keeping the slice scoped means the
 * Brief / Followups / Screener screens never have to know about it.
 *
 * Persistence: `rememberPreference` is a per-user setting (D34),
 * persisted server-side under `users.preferences.actionSheetPrefs` so
 * it roams devices. The settings feature owns the wire
 * (`useHydrateActionSheetPrefs` mirrors server → store on load;
 * `useUpdateActionSheetPrefs` writes through on change) — this store
 * stays the in-session source the action sheet actually reads, so the
 * contract is unchanged for consumers.
 */

'use client';

import { create } from 'zustand';
import type { ActionVerb } from './types';

/** Verbs that surface the action sheet by default (D34). */
export type SheetableVerb = Extract<ActionVerb, 'Archive' | 'Unsubscribe' | 'Later'>;

export interface PendingAction {
  verb: ActionVerb;
  rowId: string;
  /**
   * Source of the pending action — `'sheet'` means the action sheet
   * is mounted and Enter/Escape are intercepted; `'inline'` means the
   * inline preview is rendered alongside the row (no modal) per the
   * remember-preference path. `null` after `clearPending`.
   */
  surface: 'sheet' | 'inline';
}

export interface TriageState {
  /**
   * Per-verb sheet-skip preference. `true` = skip the sheet, render
   * the inline preview instead (the user has hit "remember this
   * choice" for that verb). Default `false` — sheet shows.
   */
  rememberPreference: Record<SheetableVerb, boolean>;
  /** Currently expanded row id, or `null` if none. */
  expandedRowId: string | null;
  /** In-flight action awaiting preview-confirm. */
  pendingAction: PendingAction | null;
  /**
   * Decisions confirmed since this tab mounted — feeds the session
   * burn-down in the header ("3 decided · 5 to go"). Client-only per
   * D200 (the durable per-day count is `stats.decidedToday`, a server
   * read). Incremented ONLY on server confirmation (D226 — never
   * optimistically); a domain batch increments by its sender count.
   */
  sessionDecidedCount: number;
  /**
   * Session payoff (D33 — real, not gamified): the summed monthly
   * volume of senders whose Archive/Later/Unsubscribe decisions the
   * server confirmed this session — "~N emails/mo of noise prevented".
   * Client-session ephemeral like the burn-down; the durable window
   * figure lives in the Activity header.
   */
  sessionNoisePrevented: number;
  /**
   * Domain-batch cards dismissed this session ("decide one by one").
   * Keyed by registrable domain — a session-scoped view preference,
   * so it lives here (D200), never on the server.
   */
  dismissedBatchDomains: string[];
}

export interface TriageActions {
  /** Toggle the remember-preference flag for one verb. */
  setRememberPreference: (verb: SheetableVerb, value: boolean) => void;
  /** Expand `id` (collapsing any other) or pass `null` to close. */
  setExpandedRow: (id: string | null) => void;
  /** Toggle: pass the currently-expanded id to collapse it. */
  toggleExpandedRow: (id: string) => void;
  /** Open the pending-action surface for `verb` on `rowId`. */
  openPending: (verb: ActionVerb, rowId: string, surface: 'sheet' | 'inline') => void;
  /** Clear any pending action (cancel or post-confirm). */
  clearPending: () => void;
  /** Bump the session burn-down by `by` confirmed decisions (default 1). */
  incrementSessionDecided: (by?: number) => void;
  /** Add a confirmed decision's monthly volume to the session payoff. */
  addSessionNoisePrevented: (by: number) => void;
  /** Collapse a domain-batch card back to per-sender rows for this session. */
  dismissBatchDomain: (domain: string) => void;
}

/** Default — sheet shows for every verb (D34). */
const DEFAULT_PREFS: Record<SheetableVerb, boolean> = {
  Archive: false,
  Unsubscribe: false,
  Later: false,
};

export const useTriageStore = create<TriageState & TriageActions>((set) => ({
  rememberPreference: { ...DEFAULT_PREFS },
  expandedRowId: null,
  pendingAction: null,
  sessionDecidedCount: 0,
  sessionNoisePrevented: 0,
  dismissedBatchDomains: [],

  setRememberPreference: (verb, value) =>
    set((s) => ({
      rememberPreference: { ...s.rememberPreference, [verb]: value },
    })),

  setExpandedRow: (id) => set({ expandedRowId: id }),

  toggleExpandedRow: (id) => set((s) => ({ expandedRowId: s.expandedRowId === id ? null : id })),

  openPending: (verb, rowId, surface) => set({ pendingAction: { verb, rowId, surface } }),

  clearPending: () => set({ pendingAction: null }),

  incrementSessionDecided: (by = 1) =>
    set((s) => ({ sessionDecidedCount: s.sessionDecidedCount + by })),

  addSessionNoisePrevented: (by) =>
    set((s) => ({ sessionNoisePrevented: s.sessionNoisePrevented + Math.max(0, by) })),

  dismissBatchDomain: (domain) =>
    set((s) =>
      s.dismissedBatchDomains.includes(domain)
        ? s
        : { dismissedBatchDomains: [...s.dismissedBatchDomains, domain] },
    ),
}));

/**
 * Reset the store to its defaults — used by tests so order doesn't
 * matter and parallel runs stay isolated. Not exported from the
 * feature barrel; tests import it directly.
 */
export function resetTriageStore(): void {
  useTriageStore.setState({
    rememberPreference: { ...DEFAULT_PREFS },
    expandedRowId: null,
    pendingAction: null,
    sessionDecidedCount: 0,
    sessionNoisePrevented: 0,
    dismissedBatchDomains: [],
  });
}
