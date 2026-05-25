# ADR-0010: Dashboard-surface motion budget extension (amends D213)

- **Status:** Accepted
- **Date:** 2026-05-25
- **Accepted:** 2026-05-25
- **Deciders:** chintan.a.thakkar@gmail.com, design-direction agent
- **Related D-decisions:** D213 (sparse, calm motion budget — 150 /
  250 / 400 ms tokens; no bouncy, no staggered, no confetti), D166
  (skeleton-first loading patterns), D200 (TanStack Query for server
  state — re-renders gated by query lifecycle)

## Context

D213 caps motion at three duration tokens (150 / 250 / 400 ms),
permits a small allowlist (hover-lift, drawer in/out, skeleton
shimmer, undo banner slide), and explicitly forbids confetti, bouncy
easings, animated charts, staggered list reveals, and idle pulse
states.

The Senders surface (Variant D, this session's design exploration)
introduces three motion patterns the current D213 budget can't carry:

1. **Sparkline draw-on** — when a KPI cell with a sparkline first
   mounts, the SVG `path` animates from `stroke-dashoffset: 100%`
   to `0` over ~400 ms. The effect signals "this number is live data,
   not a static screenshot" without any text saying so. Today the
   sparkline appears instantly and the page reads as a screenshot.
2. **Receipt-strip slide-in / slide-out** — when an action lands
   (Unsubscribe LinkedIn → receipt appears on the list), the strip
   should slide in over ~250 ms and slide out when dismissed. The
   existing `UndoTray` primitive already does this (`@keyframes
dm-toast-in` in `packages/shared/src/styles/tokens.css`), so this
   pattern is partly precedented by D213's "undo banner slide" line
   — but explicitly extending it to the senders list's inline
   receipt-strip variant makes the rule unambiguous.
3. **Group expand / collapse chevron rotate** — when a sender intent
   group expands, the chevron rotates from `-90°` (collapsed) to `0°`
   (expanded) over 150 ms ease-out. Today the intent groups in the
   prototype use static `▾` characters and toggle visibility
   instantly. The rotate makes the cause-and-effect of the click
   legible.

We deliberately do **not** propose adding the activity-pulse dot
(per Codex review in this session — pulse cycle is the single most
"dashboard-y" element and risks the brand voice). We also deliberately
do **not** propose stagger-on-first-load (the Senders list is short
enough that stagger feels theatrical).

D213's reduced-motion clause (`@media (prefers-reduced-motion:
reduce)` disables all keyframes) is unchanged and continues to gate
every motion this ADR introduces.

## Decision

We extend D213's allowlist with **three new motion patterns**, scoped
to dashboard surfaces (Senders, Activity, Brief, future Insights):

1. **Sparkline draw-on**
   - Trigger: first mount of a `<Spark>` component on a dashboard
     surface.
   - Property: `stroke-dashoffset`
   - Duration: 400 ms (existing D213 "meaningful" token)
   - Easing: `ease-out`
   - Fires once per component mount; does not re-fire on re-render.
   - Honors `prefers-reduced-motion`.

2. **Inline receipt-strip slide**
   - Trigger: receipt appears (after action) or dismisses (after
     timeout / click).
   - Property: `transform: translateY` + `opacity`
   - Duration: 250 ms (existing D213 "standard" token)
   - Easing: `ease-out`
   - Reuses the `dm-toast-in` keyframe from D166 / UndoTray.
   - Honors `prefers-reduced-motion`.

3. **Group chevron rotate**
   - Trigger: group expand / collapse click.
   - Property: `transform: rotate`
   - Duration: 150 ms (existing D213 "micro" token)
   - Easing: `ease-out`
   - Honors `prefers-reduced-motion`.

All three motions reuse D213's existing duration tokens — this ADR
adds no new timing values. The change is in which surfaces may use
which timings.

## Alternatives considered

- **Add an activity-pulse dot (2 s opacity cycle for senders that
  mailed in last 24 h):** rejected during this session's Codex review
  — pulse is the single most "dashboard-y" element and risks pulling
  the brand toward Mixpanel / Amplitude territory. Information value
  (which sender is active right now) is already carried by the
  "Active 24h" KPI cell — the per-row dot is decorative.
- **Add stagger-on-first-load (rows fade in 30 ms apart, capped at
  12 rows):** rejected because the typical Senders list is 5–20 rows
  long. Stagger feels theatrical at this scale; instant load is
  faster _and_ calmer. Worth revisiting only if list lengths grow
  past 50.
- **Animated counter-tick on hero stats (after action: 312 → 311 with
  digit roll):** rejected — see Codex pushback note in
  `~/.claude/plans/how-can-we-uplift-foamy-cloud.md` §D7. Counter
  ticks read as gamification on a surface designed to feel calm.
  Fade-swap (200 ms opacity transition) is the production behavior;
  no digit roll.
- **Skip motion extension entirely (keep D213 as-is):** rejected
  because the spark draw-on in particular makes the difference
  between "this is a real product showing me live data" and "this is
  a screenshot." The 400 ms one-time animation is the smallest move
  with the largest "feels alive" return.

## Consequences

### Positive

- Dashboard surfaces feel alive on first paint without ongoing
  visual noise.
- The three motions reuse existing duration tokens — no new timing
  inventory to govern.
- Each motion is independently disablable via `prefers-reduced-motion`.

### Negative

- Three more keyframes to maintain in
  `packages/shared/src/styles/tokens.css` (or a new
  `dashboard-motion.css` if we want clean separation — implementation
  note below).
- Spark draw-on adds a small first-paint cost (CLS / LCP impact
  bounded by the 400 ms duration). Lighthouse budget check belongs
  in the Variant D verification step.

### Neutral

- D213's forbidden list (confetti, bouncy, animated charts, idle
  pulse, page-level transitions > 300 ms) is unchanged and continues
  to apply.

## Implementation notes

Three keyframes, all reduced-motion-gated. Place in either
`packages/shared/src/styles/tokens.css` (current home for D213
keyframes) or a new `dashboard-motion.css` imported by dashboard
features only. Lazy-promotion path (per ADR-0007): start in
`apps/web/src/features/senders/` and promote to `packages/shared/`
when Activity / Brief picks up the second consumer.

```css
@keyframes dm-spark-draw {
  from {
    stroke-dashoffset: 100%;
  }
  to {
    stroke-dashoffset: 0;
  }
}

/* dm-toast-in already exists in tokens.css per D166 / UndoTray —
   reused as-is. No new keyframe needed. */

@keyframes dm-chevron-rotate-in {
  from {
    transform: rotate(-90deg);
  }
  to {
    transform: rotate(0deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .dm-spark-draw,
  .dm-chevron {
    animation: none !important;
    transition: 0.01ms !important;
  }
}
```

## References

- D213 — motion budget (150 / 250 / 400 ms tokens; allowlist;
  forbidden list)
- D166 — skeleton-first loading patterns (introduced `dm-toast-in`
  keyframe pattern this ADR reuses)
- ADR-0009 — sibling palette extension; both ADRs are pre-requisites
  for the Variant D Senders uplift
- `~/.claude/plans/how-can-we-uplift-foamy-cloud.md` §D7 — Variant D
  trade-off note on streak / counter-tick refusal
- `apps/web/prototypes/senders-uplift.html` — Variant D prototype
  showing the three motions in context
