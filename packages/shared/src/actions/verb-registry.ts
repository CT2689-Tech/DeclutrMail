// packages/shared/src/actions/verb-registry.ts
//
// Verb Registry primitive (ADR-0019) — single declarative source of
// truth for the K/A/U/L/D verb set across every Senders surface
// for FE-presentation concerns.
//
// Replaces hand-rolled verb-to-button maps that previously drifted
// across `SenderCard`, `SenderTable` row, `SenderDetail` action
// toolbar, and `SelectionBar`. Every surface that renders a verb
// affordance reads from `VERB_REGISTRY` (or a filtered subset).
//
// RELATIONSHIP TO ACTION_REGISTRY (ADR-0015 — manifest-entries.ts):
//
// `ACTION_REGISTRY` covers BE-action-pipeline metadata: execution
// kind (label-modify / policy-only / unsubscribe), tier + cleanup
// counting, capabilities per selector (`sender` / `multi-sender` /
// `sender-filter`), preview mode, label-change builders.
//
// `VERB_REGISTRY` (this file) covers FE-presentation metadata: tone,
// canBePrimary, separator, icon — the surface-facing concerns the
// ActionPopover + chip rows + buttons need to render uniformly.
//
// The two registries deliberately split because the BE descriptor's
// `execution.kind` is irrelevant on the FE button surface, and the
// FE's `tone` is irrelevant in the worker. Consumers that need BOTH
// (e.g. ConfirmActionModal — uses tone for chip + preview from BE
// descriptor) import from both.
//
// Phase 5 dead-code sweep (per docs/spec/senders-v2.md) consolidates
// these into ONE registry once the rich-action set stabilizes —
// tracked as a follow-up in FOUNDER-FOLLOWUPS.md.
//
// Lookups via `verbById` are O(1) (registry array is small + JIT
// inlines the lookup); prefer the helper over inline-find when the
// id is known at call-site so future-readers see the intent.
//
// PRIVACY (D7, D228): registry contains UI metadata only — no PII,
// no wire-data, no analytics keys. Safe to expose in client bundle.
//
// SCOPE: Senders + Sender-Detail. Triage / Brief / Activity / future
// surfaces consume the same registry once they adopt the v2 verb
// pipeline (see docs/spec/senders-v2.md v1.2 Phase 4).

/**
 * The five canonical verbs (D227 amended via ADR-0019 — Delete
 * added). New verbs require:
 *   1. New `VerbId` literal here
 *   2. New `VerbSpec` entry in `VERB_REGISTRY` below
 *   3. ADR documenting the addition + tone + canBePrimary rule
 *   4. BE worker policy (D203/D225) for the new verb
 *
 * NEVER use single letters as user-facing labels (ADR-0019
 * `Forbidden patterns`); always full word + `<Kbd>` chip.
 */
export type VerbId = 'keep' | 'archive' | 'unsubscribe' | 'later' | 'delete';

/**
 * Visual tone in popover + chip + button surfaces. Matches
 * ADR-0016 §A3 accent semantic map:
 *
 *   - `neutral` — default fg/outline (Keep, Later)
 *   - `dark`    — `color.fg` filled (Archive)
 *   - `amber`   — `color.amber` filled (Unsubscribe; action-available)
 *   - `primary` — `color.primary` teal (reserved; not used by K/A/U/L/D today)
 *   - `danger`  — `color.danger` red (Delete + irrecoverable warnings)
 *
 * `primary` is reserved for future verbs that ride the Keep-semantic
 * channel (e.g. an "Always keep" alias). Today's K/A/U/L/D don't use it.
 */
export type VerbTone = 'neutral' | 'amber' | 'dark' | 'primary' | 'danger';

export interface VerbSpec {
  /**
   * Stable id matching BE enum + URL routing. Wire format = lowercase
   * — same string flows from BE actions table `type` column through
   * `POST /api/actions` request body to the FE chip/popover render.
   */
  id: VerbId;

  /**
   * Full-word user-facing label. NEVER single letters. Translated
   * copy lands here when i18n ships (not in this ADR's scope).
   */
  label: string;

  /**
   * Single-character keyboard shortcut. Rendered as a small grey
   * `<Kbd>` chip beside the label (ADR-0019 Decision 1). Keyboard
   * accessibility via global keydown listener — typed `target`
   * checked against `isTypingTarget` to avoid stealing input
   * focus per existing convention in `apps/web/src/features/senders/keyboard.ts`.
   */
  shortcut: string;

  /**
   * Optional emoji glyph rendered before the label in popover +
   * button surfaces. Kept minimal (one glyph per verb) so the
   * popover stays scannable at narrow widths.
   */
  icon?: string;

  /** Visual tone — see `VerbTone` docstring for semantic map. */
  tone: VerbTone;

  /**
   * `true` for verbs that mutate inbox or list state. Require the
   * D226 preview modal before commit. `false` for `keep` only (no-op).
   *
   * Drives whether the action passes through `ConfirmActionModal`
   * (see Decision 15 in spec v1.2) or fires directly.
   */
  destructive: boolean;

  /**
   * `false` if the verb's effect becomes permanent after a recovery
   * window (Delete: 30 days, then Gmail Trash auto-empties).
   * `true` if undo always restores prior state cleanly via the
   * D232 undo journal.
   *
   * Surface uses: undo banner copy in `ConfirmActionModal` ("Reversible
   * 7 days" vs "Recoverable 30 days"), undo affordance enable/disable
   * in `UndoTray`, observability event payload per D159.
   */
  reversible: boolean;

  /**
   * Render a 1px hairline divider above this entry in the popover.
   * Used to visually separate Delete from K/A/U/L (the K/A/U/L set
   * being "remove-from-inbox-class" verbs vs Delete's
   * "remove-from-storage-class" verb).
   */
  separator?: boolean;

  /**
   * Whether the verb is eligible to be derived as the fact-rule
   * primary CTA on a row (per ADR-0019 + spec v1.2 Decision 9):
   *
   *   protected            → 'keep'
   *   unsub_ready          → 'unsubscribe'
   *   last_seen > 180d     → 'archive'
   *   else                 → 'keep'
   *
   * Delete has `canBePrimary: false` — it is ALWAYS overflow-only.
   * Future verbs that should never auto-recommend share this flag.
   */
  canBePrimary: boolean;
}

/**
 * The K/A/U/L/D canonical verb set in popover render order.
 * Order matters: K/A/U/L render first (in alphabetical-shortcut
 * order, matching D227's original ordering), then `separator: true`
 * places Delete after a hairline divider.
 *
 * Marked `as const` so the literal types of each entry are preserved
 * — `verbById('delete').tone` narrows to `'danger'` at the type
 * level, not just `VerbTone`.
 */
export const VERB_REGISTRY = [
  {
    id: 'keep',
    label: 'Keep',
    shortcut: 'K',
    icon: '✓',
    tone: 'neutral',
    destructive: false,
    reversible: true,
    canBePrimary: true,
  },
  {
    id: 'archive',
    label: 'Archive',
    shortcut: 'A',
    icon: '📥',
    tone: 'dark',
    destructive: true,
    reversible: true,
    canBePrimary: true,
  },
  {
    id: 'unsubscribe',
    label: 'Unsubscribe',
    shortcut: 'U',
    icon: '🚫',
    tone: 'amber',
    destructive: true,
    reversible: true,
    canBePrimary: true,
  },
  {
    id: 'later',
    label: 'Later',
    shortcut: 'L',
    icon: '⏰',
    tone: 'neutral',
    destructive: true,
    reversible: true,
    canBePrimary: true,
  },
  {
    id: 'delete',
    label: 'Delete',
    shortcut: 'D',
    icon: '🗑',
    tone: 'danger',
    destructive: true,
    reversible: true, // recoverable for 30d from Gmail Trash
    separator: true,
    canBePrimary: false,
  },
] as const satisfies readonly VerbSpec[];

/**
 * `VERB_REGISTRY` keyed by id for O(1) lookup.
 *
 * Built at module load (one-time cost). Use `verbById(id)` from
 * call-sites instead of touching the map directly so call-sites
 * stay typed against the helper signature.
 */
const VERB_BY_ID: Record<VerbId, VerbSpec> = VERB_REGISTRY.reduce(
  (acc, spec) => {
    acc[spec.id] = spec;
    return acc;
  },
  {} as Record<VerbId, VerbSpec>,
);

/**
 * Lookup a verb spec by id. The id parameter is typed against the
 * `VerbId` union, so unknown strings are rejected at compile time —
 * no runtime fallback needed.
 *
 * @example
 *   const archive = verbById('archive');
 *   // archive.tone is 'dark'; archive.label is 'Archive'
 */
export function verbById(id: VerbId): VerbSpec {
  return VERB_BY_ID[id];
}

/**
 * Verbs that may be derived as the fact-rule primary CTA on a row.
 * Filters out `delete` (per `canBePrimary: false`). Used by the
 * primary-derivation function below and by any consumer that wants
 * to render "valid primary verbs only" (e.g. SenderTable's column
 * sort menu).
 */
export const PRIMARY_ELIGIBLE_VERBS: readonly VerbSpec[] = VERB_REGISTRY.filter(
  (v) => v.canBePrimary,
);

/**
 * Fact-derived primary CTA rule, applied at every row on every
 * surface (SenderCard, SenderTable, SenderDetail toolbar, mobile row).
 *
 * Rule per spec v1.2 Decision 9 + ADR-0019 action-display section:
 *
 *   if protected            → 'keep'        (faded outline)
 *   else if unsub_ready     → 'unsubscribe' (amber filled)
 *   else if last_seen > 180 → 'archive'     (dark outline)
 *   else                    → 'keep'        (neutral outline)
 *
 * NEVER returns 'delete' — Delete is overflow-only by
 * `canBePrimary: false`.
 *
 * Pure function — same inputs always yield the same VerbId. Safe to
 * call in render path; no side effects, no async, no localStorage.
 */
export function deriveDefaultPrimary(sender: {
  protected: boolean;
  unsubReady: boolean;
  lastSeenDays: number;
}): VerbId {
  if (sender.protected) return 'keep';
  if (sender.unsubReady) return 'unsubscribe';
  if (sender.lastSeenDays > 180) return 'archive';
  return 'keep';
}

/**
 * Verbs eligible for the secondary "Also act on past emails" chip
 * row in the composite action modal (spec v1.2 Decision 15). When
 * primary is `unsubscribe` or `later`, the user may optionally
 * `archive` OR `delete` past emails as a composite second step.
 *
 * Same list, regardless of primary choice; the BE composite
 * endpoint enforces which combinations are valid.
 */
export const SECONDARY_HISTORIC_VERBS: readonly VerbSpec[] = VERB_REGISTRY.filter(
  (v) => v.id === 'archive' || v.id === 'delete',
);
