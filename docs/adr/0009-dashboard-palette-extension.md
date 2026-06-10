# ADR-0009: Dashboard-surface palette extension (amends D2)

- **Status:** Superseded by [ADR-0017](./0017-retire-dashboard-violet.md) (2026-06-03)
- **Date:** 2026-05-25
- **Accepted:** 2026-05-25
- **Superseded:** 2026-06-03 — founder review on senders-v2 spec v1.2 Decision 7 retired the violet accent in favor of single-accent discipline. Live/active affordances → emerald dot. Filter-chip active → teal fg/bg invert. The two ADR-0009 use cases both map cleanly into the existing palette.
- **Deciders:** chintan.a.thakkar@gmail.com, design-direction agent
- **Related D-decisions:** D2 (cool / Vercel palette, restrained color),
  D38 (Senders surface), D199 (lazy promotion)

## Context

D2 set a cool, Vercel-inspired palette: warm-newsprint surfaces
(`#FAFAF7` / `#F4F4F0` / `#FFFFFF`), deep-teal as the only chromatic
accent (`#006B5F`), amber for warnings, emerald for safety, and a
deliberate refusal of every other hue. The wedge of the product is
"feels trustworthy, doesn't fight for your attention" — and palette
restraint is the load-bearing element of that wedge.

The Senders surface (Variant D, this session's design exploration —
see `apps/web/prototypes/senders-uplift.html`) introduces two element
classes that the current palette can't cleanly express:

1. **"Live / active" affordances** that need to be visually distinct
   from teal (which carries Keep / VIP semantics) and from amber
   (which carries Unsubscribe / decline semantics). Examples:
   "Active in last 24h" indicators, a future activity-pulse dot on
   rows, "live" status on dashboard KPI cells.
2. **Filter-chip active state** that needs to feel different from
   action-bound teal — selecting a filter is not an action; it's a
   navigation state.

The existing `avatarColors[]` palette in `packages/shared/src/tokens/tokens.ts`
already includes `#7C3AED` (violet) as one of 8 deterministic colors
assigned to sender avatars. Promoting that hue to token-grade — and
_only_ on dashboard surfaces — gives us the third hue we need without
inventing anything new, and without weakening D2's brand discipline
on the rest of the product.

D213's motion restraint is unchanged by this ADR; ADR-0010 handles
motion separately.

## Decision

We add a **single new accent — violet `#7C3AED`** — to the design
tokens under three new token names, scoped by the consumer feature
flag `dashboardPalette` (i.e., features may opt in by importing
`color.dashboard.*` instead of `color.*`):

- `color.dashboard.accent` — `#7C3AED`
- `color.dashboard.accentSoft` — `rgba(124, 58, 237, 0.10)`
- `color.dashboard.accentBorder` — `rgba(124, 58, 237, 0.20)`

The `dashboard.*` namespace is reserved for surfaces that present
multi-metric / multi-time-series / multi-affordance views — initially
the Senders surface, and prospectively the Activity log, the Brief
dashboard, and the future Insights surface. All other surfaces
(Triage, Onboarding, Settings, Billing, Screener, Autopilot, marketing
pages) continue to use the existing D2 palette unchanged.

The violet may only be used for:

- "Live / active" status affordances (last-24h indicators, live KPI
  dots)
- Filter-chip active state on dashboard surfaces (active filter is
  navigation, not action — needs a distinct hue from teal)
- "Active filter" highlights inside the dashboard's filter rail

The violet **must not** be used for:

- Action buttons (Keep / Archive / Unsubscribe / Later — bound to
  D227's existing tones)
- Trust / privacy affordances (those stay emerald per D7 / D228)
- Recommendation tone (stays amber for Unsubscribe / dark for Archive
  / teal for Keep, per D26 / D31)
- Any non-dashboard surface

## Alternatives considered

- **Stay on D2 strictly (no new accent):** rejected because the active
  filter chip + live-status indicator both end up using teal, which
  the user already reads as "Keep / VIP." Visual ambiguity defeats
  the calm-premium feel D2 was trying to protect.
- **Promote a different hue (cyan / indigo / rose):** rejected because
  violet is already present in `avatarColors[]` — users may have seen
  it as a sender avatar — so the hue is already inside the product's
  visual vocabulary. Adding a brand-new hue is a bigger leap.
- **Use opacity / saturation variants of teal for "live"
  indicators:** rejected because the live indicator needs to read at
  a glance against a row that may already have teal accents (VIP, Keep
  recommendation). Same hue, different opacity, is not legible at the
  6px-dot scale.
- **Per-surface custom palette (Senders gets its own tokens, Activity
  gets its own, etc.):** rejected because the resulting palette
  fragmentation defeats D173's contract-layer goal — `packages/shared`
  exists so visual primitives travel across features.

## Consequences

### Positive

- Dashboard surfaces gain a third semantic hue without bleeding into
  the rest of the product's restraint.
- The violet is reused from `avatarColors`, not invented — so the
  total palette count grows by zero "brand-new" hues even as
  expressiveness grows by one.
- Surfaces opting into `color.dashboard.*` are now greppable
  — `git grep "color\.dashboard\."` lists every consumer.

### Negative

- Two palettes coexisting (default vs dashboard) means future
  agents need to know which one to import. Mitigated by the
  `dashboard/*` namespace being the _only_ place violet appears —
  if you reach for violet, you're declaring "this is a dashboard
  surface" and reviewers can flag the import accordingly.
- The promotion is partly aesthetic — there's no hard
  product-behavior failure if we don't ship this ADR. The trade is
  legibility / readability of the dashboard at first glance, which
  is harder to measure than a bug.

### Neutral

- D227 verbs (K/A/U/L) and their colored buttons are unaffected —
  Unsubscribe stays amber, Keep stays teal, Archive stays dark,
  Later stays neutral.
- The default Triage and Onboarding palettes are unchanged.

## Implementation notes

**Token addition** (`packages/shared/src/tokens/tokens.ts`):

```typescript
export const color = {
  // ... existing tokens
  dashboard: {
    accent: '#7C3AED',
    accentSoft: 'rgba(124, 58, 237, 0.10)',
    accentBorder: 'rgba(124, 58, 237, 0.20)',
  },
};
```

**Consumer convention.** Files importing `color.dashboard.*` should
include the file-header comment:

```typescript
// Dashboard-palette consumer per ADR-0009. Violet accent is permitted
// on this surface for live/active affordances only. Action verbs and
// trust affordances continue to use the default D2 palette.
```

**Lint guardrail** (deferred to a follow-up PR — flagged in
FOUNDER-FOLLOWUPS): an ESLint rule that flags imports of
`color.dashboard.*` outside of `apps/web/src/features/{senders,activity,brief}/**`.

## References

- D2 — design system direction (cool, Vercel-inspired, restrained)
- D173 — `packages/shared` is the contract layer
- D199 / ADR-0007 — lazy promotion + spec override
- D227 — canonical verbs K / A / U / L
- `apps/web/prototypes/senders-uplift.html` (Variant D) — visual
  evidence the design needs the third hue
- `~/.claude/plans/how-can-we-uplift-foamy-cloud.md` §D5 — the
  Variant D file plan that depends on this ADR
