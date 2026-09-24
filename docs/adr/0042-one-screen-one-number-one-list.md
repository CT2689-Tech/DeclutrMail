# ADR-0042: One screen — one title, one number, one list, one action

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** founder ("complete freedom… something inspired by the best products in the world"), Claude
- **Related D-decisions:** D49 (reversed), D207, D209, D210, D220, D226 (unchanged), D227 (unchanged)
- **Amends:** ADR-0009 (violet dashboard accent — retired), ADR-0016 (senders visual language — grid/table retired; A5 tone map kept as a colour source)

## Context

A 2026-09-20 survey of the app found the same thing on every screen: the
user's job is to decide and move on, and the UI was built like an analytics
dashboard. An intro card was open by default on 13 screens (with a second
help system beside it on three). 34 of 36 helper strings ran past 12 words.
Counts were stated three or four times per screen. A sender card carried 16
controls and the table 12 columns; Senders had 11 filter controls at rest
and Activity more than 20. Six app-level banners could stack. The type scale
had ten steps and the code used 21 sizes (9px in twelve places), with mono on
104 non-numeric labels. The first sender appeared ~480px down the page.

Every reviewer with teeth in this repo checks truth; none checks length, so a
caveat was always the cheapest way to pass review (CLAUDE.md §8, 2026-09-19).
This ADR is the rule that checks length and density.

## Decision

Every app screen is: **one title line, at most one big number, one list, one
primary action.** Everything else sits behind a disclosure or is deleted.

1. **Help is one place.** `ScreenIntro` renders nothing; it registers the
   screen's help with the shell, and the top bar's `?` opens it. No intro
   cards, no "About" chips. A sentence that is a _disclosure_ (what leaves the
   product, what cannot be undone, what a consent grants) is not help and
   stays at its decision point.
2. **Lists, not dashboards.** Senders is one list on every width, with a detail
   pane beside it at ≥ 1100px (`/senders?sender=<id>`). Activity is a
   day-grouped timeline. Settings is grouped rows. Rows are separated by
   hairlines; no bordered card inside a bordered card; no border + shadow.
3. **Filters behind one button**, active filters as removable chips; the
   default view shows no chip row.
4. **Triage defaults to focus mode** — one sender at a time — with the list one
   tap away. The action lifecycle (D226) is untouched: every mail-changing
   verb still renders its preview.
5. **Home is the landing screen**: one provable number (emails cleared by
   non-undone Archive + Delete, from `activity_log.affected_count`) and the
   next thing to do.
6. **One banner slot** in the shell, priority-ordered, the rest behind "+N".
7. **Type, colour, motion.** Sizes come from the `text` scale only, floor 11px.
   Mono is for numerals, keys and email addresses — never labels. Teal is the
   only accent; violet (`color.dashboard.*`) is retired from app surfaces;
   amber means Unsubscribe/warning, `danger` means Delete/error. Transitions
   use the `motion` tokens (two durations, one easing).
8. **A number appears once per screen.** A row of buttons is quiet: the verb
   keeps its colour in the lettering, and the single filled button lives where
   the decision is made (detail pane, focus card, confirm sheet).
9. **Navigation**: one flat sidebar, Home first, no group headings; Billing and
   Settings live in the account menu; plan locks show on hover/focus; the
   sidebar collapses to an icon rail; phones get a bottom tab bar.

## Alternatives considered

- **Polish in place (shorter copy, same layout):** rejected — the 2026-09-19
  copy audit already tried it; density came from structure, not word count.
- **Job-based nav regroup (4–5 destinations):** deferred by the founder until
  Home exists and its use is known. This ADR ships the no-merge version.
- **Keep the table as a power-user mode:** rejected — two list implementations
  is how the verb popover landed on the card and never the table
  (CLAUDE.md §8, 2026-07-03). Sort + filter + the detail pane cover the use.

## Consequences

### Positive

- The first sender is on screen without scrolling; each screen has one
  obvious next step.
- One list implementation on Senders — a shared-grammar change can no longer
  land on one view and miss its sibling.
- Help, banners and navigation each have exactly one home.

### Negative

- Per-sender stats (read rate, trend, last seen, you wrote) are one click
  away instead of scannable down a column.
- In Triage focus mode the user does not see the queue ahead ("See all"
  restores it).
- Plan-locked features are quieter in the nav; upgrade discovery leans on the
  paywall screens and Home.

### Neutral

- The design freeze (CLAUDE.md §5) now refers to this state. Stories remain
  the source of truth for component appearance.
