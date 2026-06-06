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
 * / `unarchive` are the cleanup + restore verbs the senders surface
 * renders (P4 web consumers) and the bulk pipeline grows into (P5+):
 *
 *   - `later`      — route a sender's mail out of the inbox into a
 *                    DeclutrMail/Later label (label-modify).
 *   - `unsubscribe`— stop future mail (its own `execution.kind`; the
 *                    one-click vs mailto resolver lands at P9, D230).
 *   - `unarchive`  — restore archived mail back to the inbox; the
 *                    Q3 single-sender "Restore from bulk" forward verb
 *                    (label-modify, no canonical K/A/U/L shortcut).
 *
 * The label-modify family is `archive` / `later` / `unarchive`, but only
 * `archive` + `later` mirror into the `action_jobs.action_verb` pg_enum
 * today — `unarchive` is deferred there until its restore pipeline lands
 * (the worker writes the verb into `undo_action_kind` + `activity_action`,
 * which do not yet include it). `unsubscribe` routes through a separate
 * pipeline and `keep` is policy-only.
 */
export const ACTION_VERBS = [
  'keep',
  'archive',
  'later',
  'unsubscribe',
  'unarchive',
  // ADR-0019 + ADR-0020 (2026-06-03) — Delete verb added per spec v1.2
  // Decision 1. Routes to Gmail Trash worker (messages.trash). 30-day
  // recovery window. Append-only — DB enum mirror migration is
  // packages/db/migrations/0019_action_verb_delete.sql.
  'delete',
] as const;
export type ActionVerb = (typeof ACTION_VERBS)[number];

/**
 * Composite-action primary verb subset (ADR-0020 + spec v1.2 Decision
 * 15). The primary `archive | later | delete` set is the ONLY allowed
 * primary today; `unsubscribe` is locked to its own intent endpoint
 * (D38 2026-06-05) until the RFC8058 / mailto / manual pipeline (D230)
 * lands. Derived as a const so the FE and BE cannot drift —
 * type-design-analyzer 2026-06-05 caught the prior parallel-literal-
 * union drift bomb.
 */
export const COMPOSITE_PRIMARY_VERBS = ['archive', 'later', 'delete'] as const;
export type CompositePrimaryVerb = (typeof COMPOSITE_PRIMARY_VERBS)[number];

/**
 * Composite-action secondary verb subset (ADR-0020). Applies on
 * Unsubscribe / Later primaries: a historic Archive or Delete window
 * that batches with the primary. Derived from the same const so a
 * future addition propagates through both BE schema + FE consumer.
 */
export const COMPOSITE_SECONDARY_VERBS = ['archive', 'delete'] as const;
export type CompositeSecondaryVerb = (typeof COMPOSITE_SECONDARY_VERBS)[number];

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
 * `snooze` / `send` append here as their verbs land.
 *
 *   - `label-modify` — archive / later / unarchive: a Gmail label-set
 *                      delta with a forward + reverse (the undo).
 *   - `policy-only`  — keep: a standing sender-policy write, no labels.
 *   - `unsubscribe`  — its own kind (Codex §4 — never label-modify). At
 *                      V2 it carries the standing side-effect label only;
 *                      the one-click vs mailto resolver lands at P9 (D230).
 */
export const EXECUTION_KINDS = ['label-modify', 'policy-only', 'unsubscribe'] as const;
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
  // ADR-0019 (2026-06-03) — Delete shortcut added per spec v1.2
  // Decision 1. Extends D227's K/A/U/L letter set to K/A/U/L/D.
  delete: 'D',
} as const;
export type CanonicalVerb = keyof typeof CANONICAL_SHORTCUTS;

/** The five D227 (amended) shortcut letters — `'K' | 'A' | 'U' | 'L' | 'D'`. */
export type CanonicalShortcut = (typeof CANONICAL_SHORTCUTS)[CanonicalVerb];

/** Type guard — narrows an arbitrary string to a known `ActionVerb`. */
export function isActionVerb(value: unknown): value is ActionVerb {
  return typeof value === 'string' && (ACTION_VERBS as readonly string[]).includes(value);
}
