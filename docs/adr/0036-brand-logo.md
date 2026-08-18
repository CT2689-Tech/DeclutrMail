# ADR-0036: Brand logo — mark, wordmark and the surfaces that carry them

- **Status:** Proposed
- **Date:** 2026-08-17
- **Deciders:** chintan.a.thakkar@gmail.com
- **Related D-decisions:** D255 (this identity), D1/D2 (typography +
  palette), D220 (promoted-component allowlist), D134 (SEO icon set)
- **Related ADRs:** ADR-0007 (component placement — §Decision 2 spec
  override), ADR-0024 (avatar monogram-first), ADR-0034 (brand icon
  cache), ADR-0017 (retiring dashboard violet — the palette moves)

## Context

DeclutrMail has shipped without a logo. Two placeholders stand in for
one today:

1. `.dm-public-brand-mark` — a teal rounded square holding the mono
   letter `D`, rendered in the marketing header
   (`public-shell.tsx:68`) and footer (`:110`).
2. `apps/web/src/app/icon.svg` — a teal card with two fading rows and
   a mint check (D134), and the rasterization source for
   `apple-icon.png`, `favicon.ico` and `public/icons/*.png`.

They do not share a form, so the product has two unrelated brand
signals depending on which surface you land on.

Note the naming collision this ADR does NOT touch: ADR-0024 and
ADR-0034 (D254) use "logo" for _sender_ brand icons served through
`GET /api/icons/:domain`. That is third-party artwork inside the
product. This ADR is DeclutrMail's own identity.

## Decision

**The mark** is an envelope whose frame breaks at the top right, with a
single unbroken stroke that enters at the crease, hits the fold, and
continues out through the gap. Mail arrives, mail leaves. The break in
the frame carries the idea — nothing is drawn twice, and there is no
badge, container or shadow.

**The wordmark** is `DeclutrMail` set in Fraunces 800 at `-0.03em`,
already loaded as `--dm-font-display` in `app/layout.tsx` as a variable
face with no pinned weight. `Mail` takes the accent, matching the
accent stroke inside the mark.

**Specification**

| Property           | Value                                      |
| ------------------ | ------------------------------------------ |
| Mark stroke        | 5.5u, round caps                           |
| Mark height        | = cap height of the D                      |
| Gap (mark to word) | 0.3 x mark height                          |
| Word size          | 0.87 x mark height; 0.52 when stacked      |
| Small cut          | <= 24px: stroke 7, shorter tail, wider gap |
| Clear space        | 16u from the tail — a LAYOUT rule          |

Clear space is the one row the component cannot enforce. The viewBox
pads 3u left and 5u top, which is bleed room for the round caps, not
clear space. Keeping 16u clear of the tail is the consumer's job, and
the `<Logo>` element's own box does not reserve it.

**The Never list.** These are the ways the mark breaks, in the order
they are likely to happen:

- **Never resize it with CSS.** `size` is the only supported sizing
  channel, because the two-cut swap is derived from it. `width` and
  `height` on the `<svg>` are presentation attributes, so a consumer
  rule like `.brand svg { width: 16px }` wins — and renders the
  _regular_ cut at 16px, which is the exact smudge the two cuts exist
  to prevent. Nothing would fail: not the type checker, not the test
  suite (which only ever sizes through the prop), not a gate.
- **Never re-colour it from a stylesheet or a `className`.** The tone
  triple is the whole colour surface.
- **Never add a badge, dot, container, card or shadow** to the mark.
  The break in the frame carries the idea; a badge reads as an unread
  count, which is the opposite of the product's claim.
- **Never redraw the small cut by scaling the large one.**
- **Never letterspace, re-weight or re-set the wordmark.** Fraunces
  800 at `-0.03em` is specification.

**Palette** — Ink `#0E1413` (frame, `Declutr`), Teal `#006B5F`
(stroke, `Mail`), Mint `#79E6DC` (dark-surface accent), Paper
`#FAFAF7`. These are the existing D1/D2 brand hexes already hardcoded
in `opengraph-image.tsx` and `manifest.ts`.

**Placement.** `<Logo>` is **pre-promoted** into
`packages/shared/src/components/logo.tsx` under ADR-0007 §Decision 2:
it is a brand-locked surface and has consumers on day 1
(`public-shell.tsx` header and footer, `legal-layout.tsx`). It is added
to the D220 promoted-component allowlist as a brand-locked entry.

**Colors are literal, never tokenized.** Every other component in
`packages/shared/` styles itself from `tokens/tokens.ts`, whose values
are `var(--dm-*)` references, so it re-themes when the palette moves.
The logo must not. ADR-0017 is the precedent that the palette does
move, and a mark that follows it is no longer a mark. The one token
reference the component keeps is `--dm-font-display` — a family, not a
colour.

**`duo` auto-inverts; `reversed` and `ink` pin.** `theme-init.js` sets
`data-theme` on `<html>` before first paint, on marketing routes too.
Measured against the dark surface (`--dm-bg: #0f1211`), the light pair
fails outright:

| Value          | On `#0f1211` | Verdict                |
| -------------- | ------------ | ---------------------- |
| Ink `#0E1413`  | **1.01:1**   | invisible              |
| Teal `#006B5F` | **2.96:1**   | fails 3:1 for graphics |

So the default `duo` tone resolves each colour through CSS
`light-dark()`, keyed off the `color-scheme` that `styles/tokens.css`
already sets (`light` on `:root`, `dark` under `[data-theme='dark']`).
Inversion is therefore pure CSS: no client component, no `document`
read, and no wrong-tone flash before hydration on the statically
rendered marketing shell. A plain `stroke` attribute sits underneath
each declaration as the fallback for a browser without `light-dark()`.

`reversed` and `ink` repeat one value across both slots, which is how
they stay pinned through a theme flip. They are for surfaces whose
background is fixed independently of the user's theme — an
always-teal card, a one-colour print or email export.

**Two cuts, not one drawing scaled.** At or below 24px the regular
cut's frame gap closes up and the tail disappears into the stroke
join, so the component swaps geometry (stroke 7, shorter tail, wider
gap) rather than scaling the 64px drawing down.

## Alternatives considered

- **Envelope with a notification badge.** Explored and rejected: the
  dot reads as unread count, which is the opposite of the product's
  claim, and it is the first thing to disappear at favicon size.
- **A `D` monogram.** Rejected — the counter fights the fold line, and
  it competes with the monogram avatars ADR-0024 already ships.
- **Keeping the letter-`D` square.** Rejected: it is a placeholder, and
  it collides visually with the sender monogram avatars.
- **Tokenized colors (`var(--dm-primary)`).** Rejected, as above.
- **A `logo.css` file with a `[data-theme='dark']` override.** Rejected
  on two counts. `packages/shared/` has exactly one CSS file today
  (`styles/tokens.css`, reached through an explicit `./tokens.css`
  export) and no component imports one, so this would introduce a
  build-and-test pattern the package does not have. More importantly a
  stylesheet puts the brand values behind a selector any consumer can
  out-specify; `light-dark()` in an inline style keeps them literal
  and in the component. Same outcome, no new machinery.
- **Passing `tone="reversed"` explicitly on dark surfaces.** Rejected:
  `public-shell.tsx` is a server component and cannot know the runtime
  theme. Making it a client component to read `data-theme` costs the
  marketing shell its static render and risks a wrong-tone flash.

## Consequences

### Positive

- One form across favicon, app icon, marketing chrome and OG card.
- `<Logo>` replaces two hand-rolled markup blocks in `public-shell.tsx`.
- The two-cut rule kills the class of bug where a 64px drawing is
  scaled to 16px and turns into a smudge.
- Consumers pass no tone. Every themed surface is correct by default,
  which is the failure mode most likely to ship unnoticed otherwise.

### Negative

- `app/icon.svg` changes, so `apple-icon.png`, `favicon.ico` and the
  three `public/icons/*.png` must be re-rasterized in the same PR.
  Stale PNGs will not fail a test, and the repo has no rasterization
  tooling — a script has to come with that PR.
- Literal hexes mean a future palette change must touch this component
  deliberately. That is the intent, but it is a maintenance edge a
  reviewer should expect.
- `light-dark()` is Baseline 2024, and the mark and the wordmark
  degrade differently on a browser without it. Both drop the style
  declaration, but what they fall back to is not the same thing:

  The mark keeps a plain `stroke` attribute underneath, and that
  fallback is load-bearing — SVG `stroke` defaults to `none`, so
  without it the mark would not render at all. It lands on the light
  pair: correct on light, invisible on dark.

  The wordmark has no equivalent and deliberately gets none. `color`
  inherits, so dropping the declaration leaves the word at the
  consumer's text colour — `var(--dm-fg)` on both day-1 consumers,
  which is legible in either theme. What is lost is the two-tone
  split: `Mail` renders in the body colour rather than the accent.
  Adding a fallback would mean a second `color` on the same element,
  which a style object cannot express, in exchange for a degradation
  that is already benign. The mark's fallback prevents an invisible
  logo; a wordmark fallback would only prevent a monochrome one.

### Neutral

- `opengraph-image.tsx` keeps its own copies of the hexes. Satori
  cannot consume the component, and the eyebrow there is a
  letter-spaced text treatment, not the wordmark. Whether the OG card
  should carry the actual mark is a separate, open question.

## Open — the card lockup is not yet specified

The app-icon lockup (mark inside a filled teal card) is a **third
cut**, and it has not been tuned. The proposed `icon.svg` draws the
heavy-cut path at `stroke-width 6.5` inside `scale(0.74)` — roughly
4.8u effective in a 64u viewBox, or **1.2px at 16px**, paper-on-teal.
Rasterized and inspected at 8x, it is less legible than the D134
placeholder it replaces, which still resolves as two rows and a check.

The two-cut rule exists to prevent exactly this and was not applied
here. The card lockup needs its own stroke weight (and possibly no
card at all below 32px) before the icon PR ships. Until then this ADR
specifies the mark and the wordmark only.

## Implementation notes

- [x] `packages/shared/src/components/logo.tsx` added, exported from
      the barrel
- [x] Colocated test mirroring `privacy-badge.test.tsx` — locks the two
      cuts, the literal hexes, the tone inversion and the a11y contract
- [x] `logo.stories.tsx` with a size ladder and the 24/25 boundary
- [x] `<Logo>` row added to the ADR-0007 pre-promotion pointer list
- [ ] CLAUDE.md §4 D220 launch-allowlist amendment (founder-only edit)
- [ ] D255 row in the plan + `IMPLEMENTATION-LOG.md`
- [ ] `public-shell.tsx` header and footer use `<Logo size={27} label={null} />`
      inside the existing `aria-label`ed `<Link>`; footer link has no
      `aria-label`, so `<Logo size={27} />` there
- [ ] `.dm-public-brand-mark` deleted from `public-shell.css`;
      `font` / `letter-spacing` dropped from `.dm-public-brand`
- [ ] Card lockup specified (see Open, above), then `app/icon.svg`
      replaced and the PNG set re-rasterized from it by a script
- [ ] `docs/brand/oauth-consent-logo-120.png` replaced, then Google
      brand verification re-run and **published inside 7 days**

## References

- ADR-0007 — component placement, spec override for brand-locked surfaces
- ADR-0024 — monogram-first avatars (the other "logo" vocabulary)
- ADR-0034 — sender brand icon cache (D254 — not this)
- ADR-0017 — retiring dashboard violet; precedent that the palette moves
