# Inbox Report: motion spec (mock companion)

Applies to the one-time Inbox Report panel at the top of `/senders` (desktop and the inline mobile panel) and to its celebration state. Mocks are in this folder; their HTML sources are in `src/`. Nothing here is built yet. It is a design proposal.

## 0. Token proposal: `display-xl` (Inbox Report only)

The type scale tops out at `4xl` = 44. I propose **one** new step, used only by the report headline number:

| Token                                         | Value                                                                                                                          | Use                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `text['display-xl']` / `--dm-text-display-xl` | **64px**, line-height 1, Fraunces wght 300, opsz 144, letter-spacing -0.02em, `font-variant-numeric: tabular-nums lining-nums` | The Inbox Report headline number (e.g. "85k"). Nowhere else. |

```css
--dm-text-display-xl: 64px;
.dm-display-xl {
  font-family: var(--dm-font-display);
  font-weight: 300;
  font-size: var(--dm-text-display-xl);
  line-height: 1;
  letter-spacing: -0.02em;
  font-variation-settings: 'opsz' 144;
  font-variant-numeric: tabular-nums lining-nums;
}
```

Rule: the headline is **rounded** ("85k", never "85,207"), so its width is short and fixed. Exact values belong in sentences.

## 1. Timing overview

| Element                                                         | Trigger                                                    | Motion                                                                 | Duration                                          | Easing                                                                    | Repeats                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Headline count-up (headline only)                               | Panel is 50% in view (IntersectionObserver, threshold 0.5) | 0 → final value, rounded format at every frame ("0k" … "85k")          | **700ms**                                         | ease-out `cubic-bezier(0.2, 0, 0, 1)` (applied to the value, not opacity) | **Once per mailbox** (persist `reportRevealSeen:{mailboxId}`) |
| Supporting facts (glyph row + sentence, the two facts, CTA row) | Same trigger, start at t=0                                 | fade in + rise 8px                                                     | **180ms** each                                    | `cubic-bezier(0.2, 0, 0, 1)`                                              | Once, staggered **60ms** (0, 60, 120, 180ms)                  |
| Celebration check                                               | Celebration state mounts                                   | stroke draw (`stroke-dashoffset`) on circle, then check                | **400ms** total (circle 0–240ms, check 160–400ms) | `cubic-bezier(0.65, 0, 0.35, 1)`                                          | Once                                                          |
| Dot burst (12 dots, plum/amber)                                 | At 200ms after mount (as the check starts)                 | translate outward 0 → 12–20px + scale 0.4 → 1 → 0.6, opacity 0 → 1 → 0 | **600ms**                                         | `cubic-bezier(0.2, 0.7, 0.3, 1)`                                          | **Once, ever per mailbox**. Not on Undo, not on remount       |
| Dismiss → strip                                                 | X tapped                                                   | panel height collapses to 44px strip, content opacity 1 → 0            | 220ms                                             | `cubic-bezier(0.2, 0, 0, 1)`                                              | —                                                             |

The glyph row (9 solid plum envelopes = the share from senders you mostly leave unread, the emphasized part; 1 faded = the rest; dark mode uses the dark `--dm-primary`) does **not** animate individually. It arrives with the sentence in stagger slot 1. Numbers inside sentences (88%, 148, 1.5 GB) never count up.

## 2. CSS / keyframes

```css
/* Supporting facts: fade + 8px rise, staggered 60ms. Add .is-revealed when 50% in view. */
.dm-report [data-reveal] {
  opacity: 0;
  transform: translateY(8px);
}
.dm-report.is-revealed [data-reveal] {
  animation: dm-report-rise 180ms cubic-bezier(0.2, 0, 0, 1) both;
  animation-delay: calc(var(--i, 0) * 60ms); /* --i: 0,1,2,3 */
}
@keyframes dm-report-rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Headline: width never jitters while counting */
.dm-display-xl {
  font-variant-numeric: tabular-nums lining-nums;
  min-width: 4ch;
  display: inline-block;
}

/* Celebration check: stroke draw, 400ms */
.dm-check circle {
  stroke-dasharray: 164;
  stroke-dashoffset: 164; /* 2πr, r=26 */
  animation: dm-draw 240ms cubic-bezier(0.65, 0, 0.35, 1) forwards;
}
.dm-check path {
  stroke-dasharray: 34;
  stroke-dashoffset: 34;
  animation: dm-draw 240ms cubic-bezier(0.65, 0, 0.35, 1) 160ms forwards;
}
@keyframes dm-draw {
  to {
    stroke-dashoffset: 0;
  }
}

/* Dot burst: 12 dots, one-time, 600ms. Each dot sets --a (angle) and --d (distance 12–20px). */
.dm-burst i {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  opacity: 0;
  animation: dm-burst 600ms cubic-bezier(0.2, 0.7, 0.3, 1) 200ms both;
}
.dm-burst i:nth-child(4n + 1) {
  background: var(--dm-primary);
} /* plum */
.dm-burst i:nth-child(4n + 2) {
  background: var(--dm-nav-marker);
} /* soft amber #d8a975 */
.dm-burst i:nth-child(4n + 3) {
  background: var(--dm-lilac);
}
.dm-burst i:nth-child(4n) {
  background: var(--dm-amber);
} /* #b45309 */
@keyframes dm-burst {
  0% {
    opacity: 0;
    transform: rotate(var(--a)) translateX(30px) scale(0.4);
  }
  30% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: rotate(var(--a)) translateX(calc(30px + var(--d))) scale(0.6);
  }
}
/* The mock PNGs show the frame at ~45% (dots visible, mid-flight). */

/* Reduced motion: final values immediately, no burst, static check, 120ms opacity fade only */
@media (prefers-reduced-motion: reduce) {
  .dm-report [data-reveal],
  .dm-report.is-revealed [data-reveal] {
    transform: none;
    animation: dm-report-fade 120ms linear both;
    animation-delay: 0ms;
  }
  .dm-check circle,
  .dm-check path {
    animation: none;
    stroke-dashoffset: 0;
  }
  .dm-burst {
    display: none;
  }
}
@keyframes dm-report-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
```

Note: the global reduced-motion block in `tokens.css` sets `animation-duration: 0.01ms !important`, which would also flatten the 120ms fade. Either scope this fade with `animation-duration: 120ms !important` inside the `.dm-report` reduced-motion rule, or accept an instant appearance. The intent is a 120ms opacity fade.

## 3. Count-up (JS sketch)

```ts
// Headline only. Runs once per mailbox; reduced-motion writes the final value immediately.
function countUp(el: HTMLElement, target: number, format: (n: number) => string) {
  const key = `dm-report-counted:${mailboxId}`;
  if (localStorage.getItem(key) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = format(target);
    return;
  }
  const io = new IntersectionObserver(
    ([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      localStorage.setItem(key, '1');
      const t0 = performance.now(),
        D = 700;
      const ease = (t: number) => 1 - Math.pow(1 - t, 3); // ease-out
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / D);
        el.textContent = format(Math.round(target * ease(p))); // format = rounded ("85k")
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    { threshold: 0.5 },
  );
  io.observe(el.closest('.dm-report')!);
}
```

- Render the **final** value in SSR/HTML (`85k`) and set `aria-label="About 85,000 emails"` on the headline. Screen readers never hear intermediate values (`aria-live` off).
- Format at each frame with the same rounding as the final value (`Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 0 })`), so it never shows a long exact number mid-count.
- Tabular figures plus `min-width: 4ch` keep the label under it from shifting.

## 4. Reduced motion summary

- Headline shows its final value at once. No count-up.
- Supporting facts: 120ms opacity fade only. No translate, no stagger.
- Celebration: static, fully drawn check. **No dot burst.**
- Dismiss → strip: instant height change, 120ms opacity.

## 5. Guardrails

- Only one motion is "loud" (the count-up), and it happens once. Everything else is ≤ 180ms.
- No looping, no confetti rain, no sound, no haptics.
- The burst never replays on Undo → redo, on remount, or after opening the share card.
- The calm fallback ("Your inbox is in good shape.", report copy v2 §1) gets **only** the 180ms rise. No count-up (no big number), no celebration, no share prompt.
