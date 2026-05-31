// @declutrmail/shared/contracts — verb constants (ADR-0015).
//
// Pure string-literal arrays + derived types. The SINGLE source of
// truth for the action verb vocabulary, shared by:
//
//   - packages/db/schema/action-jobs.ts   (explicit pg_enum migration)
//   - packages/shared/actions/manifest-entries.ts  (rich descriptors)
//
// Codex correction A (consensus 2026-05-30): the DB pg_enum is NOT
// derived from the manifest object. Enum values are append-only and
// declared explicitly in the migration; this module is the shared
// vocabulary both sides agree on, not a code-gen source. Keep it pure —
// no Zod, no logic, no cross-package imports — so the DB package can
// adopt it without pulling the React/contract tree.

/**
 * Canonical action verbs the registry models today.
 *
 * Append-only (LEARNINGS 2026-05-30 — enum values are never reordered
 * or removed; the DB enum mirrors this order). `later` / `unsubscribe`
 * / `unarchive` append here at P5 alongside their pg_enum migration +
 * manifest entries.
 */
export const ACTION_VERBS = ['keep', 'archive'] as const;
export type ActionVerb = (typeof ACTION_VERBS)[number];

/**
 * Selector axes a verb's capabilities are gated on (Codex correction C
 * — `capabilitiesBySelector`, not a single `tier`). `sender` = one
 * sender; `multi-sender` = an explicit multi-select; `sender-filter` =
 * a Pro "all matching" filter.
 */
export const SELECTOR_TYPES = ['sender', 'multi-sender', 'sender-filter'] as const;
export type SelectorType = (typeof SELECTOR_TYPES)[number];

/** Billing tiers a capability can require (D17–D21). Ordered low→high. */
export const ACTION_TIERS = ['free', 'plus', 'pro'] as const;
export type ActionTier = (typeof ACTION_TIERS)[number];

/** Rank for tier monotonicity checks (free ≤ plus ≤ pro). */
export const ACTION_TIER_RANK: Readonly<Record<ActionTier, number>> = {
  free: 0,
  plus: 1,
  pro: 2,
};

/**
 * Preview surface the action lifecycle renders before mutation
 * (D208/D226 — the preview is mandatory). Founder push-back A: three
 * values, not a boolean.
 *
 *   - `modal`          — full preview sheet (archive/later/unsubscribe)
 *   - `inline-confirm` — 200ms toast + 5s undo (keep/protect)
 *   - `silent`         — never user-triggered; reserved for Autopilot
 *                        rule-fire (no consumer at V2)
 */
export const PREVIEW_MODES = ['modal', 'inline-confirm', 'silent'] as const;
export type PreviewMode = (typeof PREVIEW_MODES)[number];

/**
 * Pipeline routing discriminant (Codex correction B). The execution
 * kind selects which worker + builder the registry hands a verb to.
 * `unsubscribe` / `snooze` / `send` append here as their verbs land.
 */
export const EXECUTION_KINDS = ['label-modify', 'policy-only'] as const;
export type ExecutionKind = (typeof EXECUTION_KINDS)[number];

/**
 * D227 canonical verbs → their hardwired single-key shortcut (K/A/U/L).
 *
 * This is the source of truth for the four letters; the manifest's
 * per-verb `shortcut` field declares them and an invariant test asserts
 * the two never drift. Includes `unsubscribe` / `later` ahead of their
 * manifest entries so the letters are pinned the moment those verbs land
 * (P5). Shortcuts bind to `event.key` (Codex §10.6), never `code`, and
 * stay invisible until the `?` cheatsheet.
 */
export const CANONICAL_SHORTCUTS = {
  keep: 'K',
  archive: 'A',
  unsubscribe: 'U',
  later: 'L',
} as const;
export type CanonicalVerb = keyof typeof CANONICAL_SHORTCUTS;

/** The four D227 shortcut letters — `'K' | 'A' | 'U' | 'L'`. */
export type CanonicalShortcut = (typeof CANONICAL_SHORTCUTS)[CanonicalVerb];

/** Type guard — narrows an arbitrary string to a known `ActionVerb`. */
export function isActionVerb(value: unknown): value is ActionVerb {
  return typeof value === 'string' && (ACTION_VERBS as readonly string[]).includes(value);
}
