# ADR-0017: Retire dashboard violet accent (supersedes ADR-0009)

- **Status:** Accepted
- **Date:** 2026-06-03
- **Accepted:** 2026-06-03 (founder signed senders-v2 spec v1.2)
- **Deciders:** chintan.a.thakkar@gmail.com
- **Related D-decisions:** D2 (Cool/Vercel palette restraint)
- **Related ADRs:** ADR-0009 (dashboard-palette extension — **SUPERSEDED**), ADR-0016 (visual language)
- **Related spec:** docs/spec/senders-v2.md v1.2 — Decision 7

## Context

ADR-0009 (2026-05-25) introduced a violet accent (`#7C3AED`) for the dashboard surface namespace (`color.dashboard.*`), scoped to two narrow use cases:

1. "Live / active" affordances (last-24h indicators, live KPI dots)
2. Filter-chip active state on dashboard surfaces

The justification at the time: teal carries Keep / Protect semantics and amber carries Unsubscribe semantics, so a third hue was needed for navigation-state vs action-semantics on dashboard surfaces.

Founder review on 2026-06-03 (senders-v2 spec v1.2 Decision 7) pushed back: every additional hue dilutes the D2 restraint that the trust wedge depends on. Both ADR-0009 use cases can render in the existing K/A/U/L palette:

- **Live / active affordances** → animated emerald dot (semantic: "alive + healthy")
- **Filter-chip active state** → teal fg-on-bg invert (already the chip pattern on Senders)

The cost of retiring violet is small (3 token entries + their CSS variables + ~5 callsites). The benefit is a stronger accent discipline that downstream surfaces (Triage, Brief, Activity, Autopilot) inherit cleanly.

## Decision

We retire the dashboard violet accent. ADR-0009 is marked `Status: Superseded` (kept on disk per ADR housekeeping policy; never deleted).

### Token changes

```diff
// packages/shared/src/tokens/tokens.ts
export const color = {
-  /**
-   * Dashboard-surface palette extension per ADR-0009 (amends D2).
-   * ...
-   */
-  dashboard: {
-    accent: '#7C3AED',
-    accentSoft: 'rgba(124, 58, 237, 0.10)',
-    accentBorder: 'rgba(124, 58, 237, 0.20)',
-  },
+  // ADR-0017 supersedes ADR-0009: dashboard violet retired. Live/
+  // active affordances → emerald dot. Filter-chip active → teal
+  // fg/bg invert. Single-accent discipline restored.
};
```

CSS variable equivalents in `packages/shared/src/styles/tokens.css` removed in the same PR.

### Callsite migration

| Old `color.dashboard.*` use   | New token + pattern                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| Live / active dot on KPI cell | `color.emerald` 6px dot w/ pulse animation                                                              |
| Active filter chip background | `color.fg` (bg) + `#FFFFFF` (text) — existing pattern in `senders-screen.tsx` `IntentChip` active state |
| Active filter chip border     | `color.fg` (matches inverted background)                                                                |

### Accent semantic map (post-retire)

| Hue     | Token                           | Semantic                                               |
| ------- | ------------------------------- | ------------------------------------------------------ |
| Teal    | `color.primary`                 | Keep verb tone, Protect status, filter-chip active     |
| Amber   | `color.amber`                   | Unsubscribe verb tone, recommendation-action-available |
| Emerald | `color.emerald`                 | Privacy / trust, success toast, live/active dot        |
| Dark    | `color.fg`                      | Archive verb tone, neutral primary, chip-active fill   |
| Red     | `color.danger` (NEW — ADR-0019) | Delete verb tone, irrecoverable-action warnings        |

No fourth navigation-state hue. Active chip = palette inversion, not a new color.

## Alternatives considered

**A. Keep violet for filter-chip active state only; retire for live/active dot.**

- Rejected: partial-retire still keeps ADR-0009's `dashboard.*` namespace alive. Cleaner to retire both uses.

**B. Replace violet with a second teal (lighter shade) for chip-active state.**

- Rejected: two teals would confuse the Keep-semantic anchor. Inversion is clearer.

## Consequences

### Positive

- Restored single-accent discipline (4 hues + danger-only-for-Delete)
- Downstream surfaces (Triage / Brief / Activity / Autopilot) inherit cleaner palette
- One fewer ADR to cite when explaining DeclutrMail's color rule

### Negative

- ~5 callsites to migrate (Phase 2 PR-FE1 absorbs)
- Future "I need a third nav-state hue" use case may resurface — counter-argument: invert + animate first; new hue last

### Neutral

- ADR-0009 stays on disk marked `Superseded by ADR-0017`
- ESLint guardrail proposed in ADR-0009 (scoping `color.dashboard.*` imports) becomes unnecessary

## Verification

- `rg "color\.dashboard\." apps/web packages/shared` returns ZERO matches after migration
- `rg "#7C3AED" packages/shared` returns ZERO matches
- ADR-0009 footer updated with `Superseded by ADR-0017` marker
- `design-system-agent` review confirms no callsites missed
