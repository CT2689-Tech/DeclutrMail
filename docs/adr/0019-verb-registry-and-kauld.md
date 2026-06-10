# ADR-0019: K/A/U/L/D verb set + Verb Registry primitive (amends D227)

- **Status:** Accepted
- **Date:** 2026-06-03
- **Accepted:** 2026-06-03 (founder signed senders-v2 spec v1.2)
- **Deciders:** chintan.a.thakkar@gmail.com
- **Related D-decisions:** D227 (canonical verbs — AMENDED), D38 (Senders surface), D199 (lazy promotion), D220 (promoted-component allowlist — EXTENDED), D226 (mandatory preview before destructive mutation), D34 (action sheet), D232 (undo journal retention)
- **Related ADRs:** ADR-0015 (action-registry — predecessor pattern this ADR consolidates), ADR-0016 (visual language — references K/A/U/L/D tones)
- **Related spec:** docs/spec/senders-v2.md v1.2 — Decisions 1, 9

## Context

D227 locked **K/A/U/L** (Keep · Archive · Unsubscribe · Later) as the canonical product verbs at launch. Founder review on 2026-06-03 surfaced a real product need outside D227's scope:

> "I get lots of Bank of America alerts and want to delete all from this sender older than 6 months."

Delete fits the **noisy-but-undeletable-by-other-verbs** use case:

- Archive moves messages out of inbox but keeps them indexed in `All Mail` — preserves history forever
- Unsubscribe stops future mail but doesn't touch past
- Later snoozes future mail
- None of K/A/U/L moves historic noise out of Gmail's storage footprint

Adding Delete as a fifth canonical verb solves the use case. The bigger problem this ADR addresses, however, is **how verbs are represented across surfaces**:

- 4 user surfaces today render K/A/U/L differently: SenderCard (4 buttons), SenderTable row (3 buttons), SenderDetail toolbar (4 buttons + kbd chips), SelectionBar (3 equal-weight). Each surface hand-rolls its own verb-to-button mapping.
- Adding Delete means a fifth touch-point at four surfaces = 4 places to update + risk of drift
- Future verbs (Mute, MarkAsSpam, etc.) hit the same N-surfaces multiplier

The right pattern is a **single declarative source of truth** for verb metadata that every surface consumes. ADR-0015 already established a partial action-registry pattern (`packages/shared/src/actions/`); this ADR consolidates and extends it.

## Decision

We amend D227 to extend the canonical verb set to **K/A/U/L/D** (Keep · Archive · Unsubscribe · Later · Delete) and introduce a **Verb Registry primitive** at `packages/shared/src/actions/verb-registry.ts` as the single declarative source of truth for verb metadata.

### Delete semantics

| Aspect                            | Value                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| Verb id                           | `delete`                                                                                   |
| Keyboard shortcut                 | `D`                                                                                        |
| Gmail operation                   | `messages.trash` (moves to Trash — NOT `messages.delete` which is permanent-immediate)     |
| Recovery window                   | 30 days from Gmail Trash (Gmail auto-empties Trash at 30d)                                 |
| Undo journal entry                | Type `delete`, retention ≥7d per D232, undoable via composite_id cascade                   |
| User-facing tone                  | Red / danger (new accent — `color.danger`)                                                 |
| Confirm gate                      | D226 preview mandatory; no type-to-confirm (Trash recovery window is sufficient deterrent) |
| `canBePrimary`                    | `false` — Delete is ALWAYS overflow-only; never a fact-derived primary CTA                 |
| Render separator above in popover | `true` — visually distinct from K/A/U/L                                                    |

### Verb Registry shape

```ts
// packages/shared/src/actions/verb-registry.ts

export type VerbId = 'keep' | 'archive' | 'unsubscribe' | 'later' | 'delete';

export interface VerbSpec {
  /** Stable id matching BE enum + URL routing. */
  id: VerbId;
  /** Full-word user-facing label. */
  label: string;
  /** Single-character keyboard shortcut. */
  shortcut: string;
  /** Optional icon glyph for popovers + chips. */
  icon?: string;
  /** Visual tone in popover + chip + button surfaces. */
  tone: 'neutral' | 'amber' | 'dark' | 'primary' | 'danger';
  /**
   * `true` for verbs that mutate inbox or list state — require the
   * D226 preview modal before commit. `false` for `keep` (no-op).
   */
  destructive: boolean;
  /**
   * `false` if the verb's effect cannot be reversed automatically
   * after a window (e.g. `delete` becomes permanent after 30d).
   * `true` if undo always restores prior state.
   */
  reversible: boolean;
  /** Render a divider above this entry in the popover. */
  separator?: boolean;
  /**
   * Whether the verb may be derived as the fact-rule primary CTA on
   * a row. `false` = always overflow-only (e.g. `delete`).
   */
  canBePrimary: boolean;
}

export const VERB_REGISTRY: readonly VerbSpec[] = [
  {
    id: 'keep',
    label: 'Keep',
    shortcut: 'K',
    tone: 'neutral',
    destructive: false,
    reversible: true,
    canBePrimary: true,
  },
  {
    id: 'archive',
    label: 'Archive',
    shortcut: 'A',
    tone: 'dark',
    destructive: true,
    reversible: true,
    canBePrimary: true,
  },
  {
    id: 'unsubscribe',
    label: 'Unsubscribe',
    shortcut: 'U',
    tone: 'amber',
    destructive: true,
    reversible: true,
    canBePrimary: true,
  },
  {
    id: 'later',
    label: 'Later',
    shortcut: 'L',
    tone: 'neutral',
    destructive: true,
    reversible: true,
    canBePrimary: true,
  },
  {
    id: 'delete',
    label: 'Delete',
    shortcut: 'D',
    tone: 'danger',
    destructive: true,
    reversible: true,
    canBePrimary: false,
    separator: true,
  },
];

/**
 * Lookup a verb by id. Throws if id is not in the registry — by
 * design; the union type already ensures only valid ids reach this fn.
 */
export function verbById(id: VerbId): VerbSpec;

/**
 * Default-fact rule for primary CTA derivation. Used by SenderCard,
 * SenderTable row, SenderDetail toolbar, and mobile row.
 */
export function deriveDefaultPrimary(sender: {
  protected: boolean;
  unsubReady: boolean;
  lastSeenDays: number;
}): VerbId;
```

### Action display rule (all surfaces inherit)

Per ADR-0016 §A5 + Decision 9 in spec v1.2:

```
Primary derivation (every row, every surface):
  protected            → 'keep'        (faded outline)
  unsub_ready          → 'unsubscribe' (amber filled)
  last_seen > 180d     → 'archive'     (dark outline)
  else                 → 'keep'        (neutral outline)

Overflow ⋯ (every row, every surface):
  Render VERB_REGISTRY entries filtered by sender capability
  Delete renders w/ tone='danger' + separator above

Bulk SelectionBar:
  Equal-weight K/A/U/L/D (bulk = move workflow; no primary CTA)
```

### Forbidden patterns

- Single-letter button labels in production UI (`[K]` `[A]` alone). Full-word + `kbd` chip ALWAYS.
- Per-surface verb-to-button hand-rolling. EVERY surface reads `VERB_REGISTRY`.
- Adding a new verb without a Verb Registry entry. Registry is the only source of truth.
- Delete rendered as a fact-derived primary CTA. Always overflow.

### Accent color additions

D2 + ADR-0009 + ADR-0016 §A3 locked teal/amber/emerald/dark. This ADR adds **red/danger** for Delete verb tone + irrecoverable-action warnings. Token to be added in Phase 1 BE foundation PR:

```ts
// packages/shared/src/tokens/tokens.ts
export const color = {
  // ... existing ...
  danger: '#DC2626', // red — Delete verb tone, irrecoverable-action banner
  dangerBg: 'rgba(220,38,38,0.08)',
  dangerBorder: 'rgba(220,38,38,0.32)',
};
```

`color.danger` may ONLY be used for:

- Delete verb buttons + popover entry
- Irrecoverable-action warning banners (e.g. "Permanent after 30 days")
- Confirm-modal Delete-tone CTA fill

FORBIDDEN uses (same rigor as ADR-0009's violet restrictions):

- General error states (use existing `color.red` if present, or migrate; ADR-0014 error-code-registry color rule prevails for app errors)
- Any non-Delete action
- Privacy / trust affordances (those stay emerald per D7/D228)

## Alternatives considered

**A. Keep D227 K/A/U/L unchanged; add a "spam folder" sender label instead of Delete.**

- Rejected: Gmail's spam folder is a deliverability mechanism, not a storage-cleanup verb. Doesn't address "delete historic noise" use case.

**B. Make Delete a sub-mode of Archive (e.g. "Archive + remove from All Mail").**

- Rejected: confuses two distinct operations. User mental model of Delete = "remove forever (within recovery window)" is clearer.

**C. Hand-roll verb metadata per surface; document the convention in a markdown style guide.**

- Rejected: every new verb still touches 4 surfaces. Drift inevitable. Style guides don't enforce.

**D. Verb Registry but lower placement — feature dir until ≥2 consumers (per D199 lazy promotion).**

- Rejected: 4 consumers exist on day one (card, table, detail, SelectionBar). Lazy promotion threshold met before the PR opens.

## Consequences

### Positive

- Single declarative source of truth for verb metadata
- Adding a future verb = 1 file changed (registry) + automatic surface coverage
- Delete addresses the founder's "BofA-alerts" storage-cleanup use case
- Cross-surface consistency enforced by typing (`VerbId` union; switch exhaustiveness)
- Lays groundwork for the unified `POST /api/actions` endpoint (ADR-0020) which reads the same enum
- ADR-0016 visual language gets a fifth tone (`danger` red) cleanly scoped to Delete

### Negative

- Plan-drift on D227 (canonical verbs amended). Founder signing the senders-v2 spec v1.2 ratifies this; ADR records the amendment.
- D220 promoted-component allowlist gains 2 entries (`verb-registry.ts`, `action-popover.tsx`); founder mark per spec v1.2 sign-off.
- Existing per-surface verb code must be replaced — 4 surfaces touched in Phase 2 PR-FE1.

### Neutral

- ADR-0015 (action-registry) is partial-superseded — its scope was narrower (single action descriptor); Verb Registry generalizes. Mark ADR-0015 as `Status: Superseded by ADR-0019` in next housekeeping pass.
- Existing single-verb backend endpoints (`POST /api/actions/archive` etc.) retire in favor of unified `POST /api/actions` per ADR-0020 — see that ADR for the BE-side compose contract.

## Verification

- Storybook coverage for `ActionPopover` rendering full K/A/U/L/D registry (D210)
- Storybook story for Verb Registry visual-reference (each verb's tone + icon + shortcut)
- Type-level exhaustiveness check via switch on `VerbId` (compile-error if registry gains a verb without consumers updating)
- Integration test: SenderCard + SenderTable row + SenderDetail toolbar + SelectionBar all render Delete in popover w/ red tone + separator
- `pnpm typecheck` + `pnpm lint` green
- `design-system-agent` review on Phase 2 PR-FE1
- `architecture-guardian` review on ADR-0020 companion BE work
