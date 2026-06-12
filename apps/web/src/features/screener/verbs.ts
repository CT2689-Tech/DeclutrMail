/**
 * Screener verb metadata — the canonical K/A/U/L/D set (D227 +
 * ADR-0019), single source for the toolbar buttons, the preview's
 * confirm copy, and the tests that pin the order. The D227-banned
 * verb (the internal `triage_decision` enum word) is never a label
 * here — only the five canonical verbs are.
 */

import type { ScreenerDecideVerb, ScreenerRecommendationVerdict } from './data';

/** Canonical render order — K/A/U/L/D. */
export const VERB_ORDER: readonly ScreenerDecideVerb[] = [
  'keep',
  'archive',
  'unsubscribe',
  'later',
  'delete',
];

/** Capitalised user-facing label per verb. */
export const VERB_LABEL: Record<ScreenerDecideVerb, string> = {
  keep: 'Keep',
  archive: 'Archive',
  unsubscribe: 'Unsubscribe',
  later: 'Later',
  delete: 'Delete',
};

/** Single-key hint per verb (D227 amended — K/A/U/L/D). */
export const VERB_KEY_HINT: Record<ScreenerDecideVerb, string> = {
  keep: 'K',
  archive: 'A',
  unsubscribe: 'U',
  later: 'L',
  delete: 'D',
};

/** Map an engine verdict to its verb label for the recommendation pip. */
export function verdictLabel(verdict: ScreenerRecommendationVerdict): string {
  return VERB_LABEL[verdict];
}
