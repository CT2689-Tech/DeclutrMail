import { MAX_UNDO_WINDOW_DAYS, MIN_UNDO_WINDOW_DAYS } from './resolve';

/**
 * The Activity Undo window in days when every tier grants the same one,
 * or `null` when the ladder diverges.
 *
 * Copy asks this before it phrases anything. While it is a number, a
 * surface can promise "30 days" outright; while it is `null`, the honest
 * phrasing is plan-dependent because the answer genuinely varies.
 *
 * This exists because the ladder went uniform on 2026-08-23 (undo 7d → 30d
 * on every tier) and nine shipped copy sites went on hedging — "your
 * plan's Undo window" — about a variance that no longer existed, while the
 * marketing hero already promised "30-day undo". A user reading the hedge
 * mid-Delete has to go look up a number the product knows.
 *
 * Deriving rather than hardcoding is the point: if a future packaging
 * change re-splits the window, every consumer degrades to the accurate
 * plan-dependent wording with no copy edit.
 */
export const UNIFORM_UNDO_WINDOW_DAYS: number | null =
  MIN_UNDO_WINDOW_DAYS === MAX_UNDO_WINDOW_DAYS ? MIN_UNDO_WINDOW_DAYS : null;
