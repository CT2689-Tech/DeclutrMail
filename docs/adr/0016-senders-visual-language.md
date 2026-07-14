# ADR-0016: Senders + Sender-Detail visual language alignment

- **Status:** Proposed
- **Date:** 2026-06-03
- **Deciders:** chintan.a.thakkar@gmail.com
- **Related D-decisions:** D1 (Geist Sans + Mono), D2 (Cool/Vercel
  palette), D26/D31 (recommendation tone semantics), D38–D46 (Sender
  Detail surface), D47/D48/D49 (Senders + Weekly Hero), D199 (lazy
  promotion), D210 (Storybook coverage), D227 (K/A/U/L canonical verbs)
- **Related ADRs:** ADR-0009 (dashboard violet accent for live/active
  - filter-chip), ADR-0011 (editorial copy scope), ADR-0012 (senders
    intent groups — SEMANTICS retained here; CHROME consequences
    amended), ADR-0014 (senders total-received counter + magnitude bar)

## Context

Founder review on 2026-06-03 surfaced two compounding visual
problems in the Senders surface:

1. **Inconsistent numeric typography** across paired views.
   `SenderCard` uses Fraunces `display/600/32px` for its primary
   monthly-volume number. `SenderDetailHeader` uses Fraunces
   `display/600/22px` for the sender name. `StatsStrip` (Sender
   Detail) uses Fraunces `display/600/20px` for stat values.
   `SenderTable` total-received cell uses Fraunces `display/600/18px`
   for the row total. Same role (primary numeric), four different
   sizes, identical weight, no shared primitive — every screen drifts
   its own scale.

2. **Tone-wash by intent on cards** (`SenderCard.TONE_BY_INTENT`)
   gives every grid card a gradient background + accent color
   derived from `intentOf(sender)` (Cleanup amber / Move later
   neutral / Protect teal / People neutral). The Sender Detail
   surface this navigates to has no equivalent tone — detail uses
   neutral `color.card` chrome everywhere. Click "BofA" card with
   amber Cleanup wash → land on detail page with no wash → visual
   discontinuity at the highest-traffic navigation in the product.
   On top of that, the wash labels the sender by inferred intent
   ("Cleanup") which the founder reported as a trust hit on
   financial-institution senders.

Two adjacent surfaces, one navigation link between them, no shared
typography primitive, conflicting chrome rules. Visual incoherence
reads as carelessness — particularly hostile on a product whose
wedge is "feels trustworthy."

## Decision

We adopt a **shared visual language for the Senders + Sender-Detail
surfaces**, codified as Layer A (cross-surface typography + chrome
rules) and Layer B (Senders-specific dialect).

### Layer A — cross-surface

**A1. Numeric typography roles + scale.** Defined as a single
`NumericDisplay` shared primitive in
`packages/shared/src/components/numeric-display.tsx` with variants:

| Variant   | Font       | Size | Weight | Tracking | Use                                                    |
| --------- | ---------- | ---- | ------ | -------- | ------------------------------------------------------ |
| `hero`    | Fraunces   | 40px | 300    | -0.03em  | Card primary volume, hero slice headline numbers       |
| `display` | Fraunces   | 28px | 400    | -0.025em | Sender Detail header name, sender-table total cell     |
| `stat`    | Fraunces   | 20px | 500    | -0.02em  | Stat strip values (Detail + card stat strip)           |
| `data`    | Geist Mono | 13px | 500    | 0.01em   | Inline counts, percents, dates (always `tabular-nums`) |

Every consumer of "a primary number on a senders surface" reaches for
`NumericDisplay variant="…"`. Direct `font.display` + `fontSize: N`
combinations are deprecated on these surfaces and migrate in this PR.

**A2. Chrome scale.**

| Surface element                                            | Chrome rule                                                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Sender card                                                | `background: color.card`, `border: 1px solid color.line`, `borderRadius: 8` (radius.md). **No tone-wash by intent.** |
| Sender Detail header / stats / charts / messages / history | `background: color.card`, `border: 1px solid color.line`, `borderRadius: 12` (radius.lg). Unchanged.                 |
| Hero slice card (Weekly Hero)                              | Retains its current bloc wash + amber/teal duality — see Layer A4 exception.                                         |
| Chip                                                       | `borderRadius: pill`, hairline border, fill when active. Unchanged.                                                  |
| Magnitude bar                                              | 2px under-bar at bottom edge of card / row. Color rule below.                                                        |

**A3. Accent semantics (consolidated, not amended).** Existing D26 /
D31 / ADR-0009 hue map is restated here for clarity and locked. No
new hues introduced.

| Hue     | Token                               | Semantic meaning                                                                                                                            | Forbidden uses                                                   |
| ------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Teal    | `color.primary`                     | Keep verb tone (D26/D31), Protect status                                                                                                    | Action-recommended, navigation-active                            |
| Amber   | `color.amber`                       | Unsubscribe verb tone (D26/D31), recommendation-action-available (magnitude bar when intent=cleanup, hero "High-confidence cleanups" slice) | Live status, navigation-active                                   |
| Emerald | `color.emerald`                     | Privacy / trust badges (D7/D228), success toast                                                                                             | Action recommendations                                           |
| Violet  | `color.dashboard.accent` (ADR-0009) | Live/active affordances, filter-chip active state on dashboard surfaces                                                                     | Action buttons (D227), trust affordances, non-dashboard surfaces |
| Dark    | `color.fg`                          | Archive verb tone (D26), neutral primary                                                                                                    | Anywhere else as fill                                            |

**A4. Hero slice retains its current bloc treatment.** D48 mandates 3
named slices (High-confidence cleanups, Volume spikes, Long-quiet).
Their amber/teal/neutral duality serves the comparison framing and
is retained verbatim by this ADR. Hero is the only surface that may
use tone-wash backgrounds.

**A5. Action display.** K/A/U/L (D227) verb buttons follow the
existing tone mapping (Keep=teal, Archive=dark, Unsubscribe=amber,
Later=neutral). One primary verb per row/card; secondaries collapse
to an overflow `⋯` popover. This primitive (`ActionPopover`) is
deferred to a follow-up ADR + PR — out of scope here; this ADR locks
typography + chrome only.

**A6. Motion budget.** Single orchestrated mount cascade (≤400ms
total). After mount: zero motion except focus rings + 120ms hover
ease. `prefers-reduced-motion` honored everywhere. Unchanged from
existing practice; codified here so later premium-feel work cannot
silently exceed it.

### Layer B — Senders dialect

**B1. Magnitude bar (extends ADR-0014).** The 2px under-bar
primitive renders on:

- Sender card (bottom edge of card)
- Sender table row (right of total cell, current behavior unchanged)
- Hero slice card stat strip (under TOP SENDER value)

Color rule: `color.amber` when `intentOf(sender) === 'cleanup'`,
else `color.fgSoft`. Denominator = `globalMaxTotal` from page-1
`meta.query` (already on wire per ADR-0014).

**B2. Card stat strip vocabulary.** Three stats per card — `READ` /
`LAST` / `STATUS` (current) — retained. Label styling unified with
Detail stats strip: Geist Mono 10px, letter-spacing 0.12em, uppercase,
`color.fgMuted`. Values use `NumericDisplay variant="data"`.

**B3. Card intent semantics — separated from chrome.** `intentOf`
continues to drive:

- Magnitude bar color (amber if cleanup)
- Primary CTA derivation (lead verb)
- Chip-row counts on `senders-screen`

`intentOf` no longer drives:

- Card background (now `color.card` uniformly)
- Card border color (now `color.line` uniformly)
- Card sparkline color (now `color.fgSoft` uniformly, except hero)
- Card "STATUS" stat color (now `color.fg` unless protected)

This separation lets a later fact-first cut retire `intentOf`
without re-touching card chrome.

### What is NOT decided by this ADR

- Fact-first semantic cut (replacing intent buckets with fact filter
  chips) — own ADR, own PR
- Mobile redesign — own ADR (Layer C)
- `ActionPopover` cross-surface unification — follow-up ADR + PR
- Hero copy rewrite (`HIGH-CONFIDENCE CLEANUPS` → fact predicate) —
  separate from visual alignment
- TOP SENDER bug (CT2689 monogram appearing) — independent hotfix,
  not a visual decision
- Dark theme — deferred to a future Pro-mode toggle

## Consequences

### Positive

- Single shared primitive (`NumericDisplay`) for primary numerics —
  every future surface has one place to import from
- Card↔Detail navigation no longer presents jarring chrome
  discontinuity
- BofA / Robinhood / Chase no longer carry an inferred amber
  "Cleanup" wash — `intentOf` still drives chip counts + lead verb,
  but the SENDER ROW reads as a neutral row of facts
- Magnitude bar consolidated to a single primitive consumed by 3+
  surfaces with one denominator rule
- Future surfaces (Triage, Brief, Activity, Autopilot) inherit
  Layer A typography + chrome rules without re-litigating

### Negative

- Card visual loses one signal channel (tone-wash by intent). Hero
  still carries the channel; chips still carry counts. Net signal
  loss judged acceptable given the trust-hit class it created.
- Existing Storybook stories for `SenderCard` need re-baselining
  (any visual regression test catches drift — by design).
- Three surfaces touched in one PR — `sender-card`, `sender-table`,
  `sender-detail` (+ its children). Higher review surface than a
  per-component PR, but lower drift surface than 3 sequential PRs.

### Neutral

- ADR-0009 violet accent untouched; this ADR does not introduce or
  retire any hue
- ADR-0014 magnitude bar contract unchanged; consumer surface
  expanded
- ADR-0012 intent groups SEMANTICALLY unchanged; CHROME
  consequences amended

## Alternatives considered

- **Keep tone-wash, port the wash to Sender Detail header.**
  Rejected: reinforces "Cleanup" reading on the very surfaces
  (BofA/Chase) the founder flagged as untrustworthy. Compounds the
  trust hit class rather than resolving it.
- **Drop Fraunces, go all-mono.** Rejected: Fraunces editorial moment
  is brand-load-bearing (per D1 / ADR-0011); replacing with mono
  collapses the brand voice. Pro-mode toggle reserved for a future
  ADR.
- **One PR per surface (card → row → detail).** Rejected: drift
  guaranteed between PRs, each design-system-agent gate run on
  partial state, founder eyeballs incomplete progress 3 times.
  Single-PR alignment trades larger diff for coherent ship.

## Verification

- Storybook stories rebuilt for `SenderCard`, `SenderTable` row,
  `SenderDetailHeader`, `StatsStrip`
- New Storybook story `numeric-display.stories.tsx` rendering all
  four variants side-by-side as visual reference
- Manual smoke: navigate Sender Card → Sender Detail; verify no
  chrome discontinuity, verify volume numerics at consistent scale
- `design-system-agent` review (D210) on the PR
- `typescript-reviewer` advisory review on the PR
- `flow-completeness-auditor` advisory review on the PR
