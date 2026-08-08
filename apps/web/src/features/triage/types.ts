/**
 * Triage feature — closed unions shared across the feature.
 *
 * Per MISTAKES.md (2026-05-20): closed value-sets are modeled as
 * union types so producer/consumer mismatches fail at `tsc`. No
 * `string` fallbacks.
 *
 * `TriageVerdict` mirrors `packages/db/src/schema/triage-decisions.ts`
 * `triage_verdict` enum verbatim — same lowercase value set as the DB,
 * so a fixture row drops straight into a real query result.
 *
 * D227 — the user-facing verbs (Keep / Archive / Unsubscribe / Later
 * → K/A/U/L) are derived from `TriageVerdict` at render time. Delete is
 * an explicit user action and is never emitted as a recommendation. The
 * `ActionVerb` type below is a 1:1 capitalised mapping consumed by
 * the toolbar, action sheet, and preview. "Screen" is intentionally
 * absent (internal enum only — D227 hard rule).
 */

import { VERB_REGISTRY } from '@declutrmail/shared/actions';

/** The four verdicts the engine can emit (Delete is user-chosen only). */
export type TriageVerdict = 'keep' | 'archive' | 'unsubscribe' | 'later';

/**
 * The user-facing verb on the triage toolbar (D29, D227).
 *
 * Order matters — K/A/U/L/D is the canonical UI order. Tests assert this
 * order from a single source so a refactor that reorders the toolbar
 * keys fails fast.
 */
export type ActionVerb = 'Keep' | 'Archive' | 'Unsubscribe' | 'Later' | 'Delete';

/** Past-tense labels for toasts + undo receipts (single source). */
export const VERB_PAST: Record<ActionVerb, string> = {
  Keep: 'Kept',
  Archive: 'Archived',
  Unsubscribe: 'Requested unsubscribe from',
  Later: 'Moved to Later',
  Delete: 'Moved to Gmail Trash',
};

/** Keyboard shortcut for each verb — single source so the toolbar
 *  hint, the test, and the action-sheet copy never drift. */
export const VERB_SHORTCUT = Object.fromEntries(
  VERB_REGISTRY.map((verb) => [verb.label, verb.shortcut]),
) as Record<ActionVerb, string>;

/** Canonical render order — sourced from the shared K/A/U/L/D registry. */
export const VERB_ORDER = VERB_REGISTRY.map((verb) => verb.label) as readonly ActionVerb[];

/** Map a lowercase verdict to its capitalised verb. */
export function verdictToVerb(v: TriageVerdict): ActionVerb {
  switch (v) {
    case 'keep':
      return 'Keep';
    case 'archive':
      return 'Archive';
    case 'unsubscribe':
      return 'Unsubscribe';
    case 'later':
      return 'Later';
  }
}
