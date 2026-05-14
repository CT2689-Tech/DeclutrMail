# Marketing page implementation rules

Concrete rules for porting canonical marketing HTML to React without the iteration cost. Every rule here exists because the Landing page port hit the bug once and the user caught it. Run the checklist at the end **before** claiming a page is done.

## Where the canonical lives

All marketing pages have a canonical HTML at:

```
/tmp/declutr-design-bd3l/declutrmail-design-system/project/ui_kits/product/v2/marketing/<page>.html
```

Each canonical HTML often has an inline `<style>` block at the top — that's **page-specific CSS** that needs porting to a co-located `<Page>.css` file. The marketing-shared classes (`.nav`, `.hero`, `.btn`, `.eyebrow`, `.pill`, `.stat-strip`, `.steps3`, `.conv`, `.site-footer`, etc.) live in `src/index.css` and are already ported.

## Typography rules

### Body text scale — only these three sizes

| Role      | Size   | Used for                                                                                                      |
| --------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| **LEAD**  | 17px   | Hero deck (one per page)                                                                                      |
| **BODY**  | 15px   | Every other body paragraph (FAQ answers, twoup, section subtitles, 3-step cards, privacy text, dark sections) |
| **SMALL** | 13.5px | Footer links, UI captions                                                                                     |

**Anti-pattern**: paragraphs at 13.5 / 14 / 15 / 15.5 / 16 / 17 px scattered across sections. The eye picks up half-pixel differences and reads them as drift. Stick to the three sizes above.

### Editorial display scale (Fraunces)

| Element               | Sizing                             | Notes                                                                                          |
| --------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| Hero h1               | `clamp(40px, 4.8vw, 64px)`         | **DO NOT exceed 64px max** even at large viewports. Larger caps read as poster, not editorial. |
| Section h2            | `clamp(26px, 2.8vw, 36px)`         | Defined in `.section h2` — use it.                                                             |
| Sub-section h3        | 20-24px sans (Inter), not Fraunces | Product UI surfaces use Inter.                                                                 |
| FAQ question title    | 19px Fraunces 500                  | `.qtitle` class. Italic accent inside `<em>`.                                                  |
| Stat strip number     | 32px Fraunces 700                  | `.stat-strip .n` class.                                                                        |
| Pricing tier `.price` | 38px Fraunces 600                  | `.tiers .tier .price` class.                                                                   |

### Italic accent budget

- **Maximum 3-4 italic accents per page**, ever. Italic marks differentiators, not decoration.
- Each italic phrase must pass the test: "could a competitor say this exact phrase verbatim?" If yes, drop the italic.
- The brand wordmark italic ("_Mail_" in the brand atom) is an always-on signature — doesn't count toward the budget.

### Italic font-variation-settings

**Always** use:

```css
font-variation-settings:
  "opsz" 144,
  "SOFT" 100,
  "WONK" 0;
```

Never `WONK 1`. WONK 1 gives Fraunces letters a curly, ornamental quirk that reads as "broken/off typography." SOFT 100 alone provides the editorial softness without the wonk exaggeration.

## Layout rules

### Container

- Max-width: **1200px**, padding: 0 28px (0 18px on mobile)
- Marketing pages MUST use `.container` consistently
- Don't nest `.container` inside another `.container`

### Section padding

- `.section`: 56px top/bottom
- `.section.alt`: card-colored background, hairline borders top/bottom

### Hero asymmetric grid (Landing pattern, reusable)

```jsx
<section className="hero">
  <div className="container">
    <div className="hero-grid">
      <div className="hero-copy">…eyebrow, h1, deck, actions…</div>
      <div className="hero-preview-wrap">…visual or preview card…</div>
    </div>
  </div>
</section>
```

- 1.18fr / 1fr split with 48px gap on desktop
- Collapses to 1fr at 980px breakpoint
- `.hero-preview-wrap` gets `transform: rotate(1.2deg)` and `margin-right: -4vw` for off-grid bleed
- Settles to rotate(0) on hover

## CSS specificity gotchas

### CTA modifier inside parent container

When a `.cta` modifier sits inside a parent container like `.links`, the descendant selector beats the modifier:

```html
<div class="links"><a class="cta">Sign in</a></div>
```

```css
/* This loses: */
.nav .cta {
  padding: 8px 14px;
  color: #fff;
} /* specificity 20 */

/* This wins (because .a is descendant): */
.nav .links a {
  padding: 6px 0;
  color: var(--ink-sub);
} /* specificity 21 */

/* Fix: match the descendant selector */
.nav .links a.cta {
  padding: 8px 14px;
  color: #fff;
} /* specificity 22 ✓ */
```

**Rule**: When defining CTA styles inside a known parent, always include the descendant in the selector.

## Component rules

### Brand favicons (preview-row `.av`)

When showing brand entities (LinkedIn, Substack, etc.) in a list:

```jsx
<span className="av">
  <img
    src="https://www.google.com/s2/favicons?domain=DOMAIN.com&sz=64"
    alt=""                    {/* decorative; row context provides meaning */}
    loading="lazy"
    decoding="async"
  />
</span>
```

CSS for `.av`:

```css
.preview-row .av {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: hsl(var(--card)); /* WHITE — favicons bring their own color */
  border: 1px solid hsl(var(--border));
  overflow: hidden;
}
.preview-row .av img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
```

**Anti-patterns**:

- Don't put a colored bg behind the favicon (favicons embed their own brand color; the result is double-bordered noise)
- Don't include a fallback letter character (broken-img is rare with Google's API; empty white box is acceptable)
- Don't use single-letter avatars when real brand favicons are available (two different "L"s for LinkedIn and Letters-of-Note created visual confusion)

### Tag / pill character budget

| Component                   | Max chars | Column width if shown in grid |
| --------------------------- | --------- | ----------------------------- |
| `.pill` (inline)            | ≤14 chars | n/a, inline                   |
| FAQ `.tag` (in tags column) | ≤14 chars | 156px                         |
| Stat strip `.n` (value)     | ≤8 chars  | flex cell                     |
| Stat strip `.l` (label)     | ≤32 chars | flex cell                     |

If your label is longer than the budget, **change the budget first** (widen the column or rephrase the label), don't ship overflow.

### Stat strip phrasing

Stat-strip value + label must read naturally as a sentence:

- ✓ "0 bytes" / "Of your messages, ever read" → parses as "0 bytes of your messages, ever read"
- ✗ "Never" / "Do we read your messages" → parses as archaic inverted "Never do we read your messages"
- ✓ "~5 min" / "Most people are done in"
- ✓ "7 days" / "To change your mind"

Values should be quantitative when possible. Avoid pseudo-quantitative words like "Never" or "Always" when a real number works.

## Voice / copy rules (restated from CLAUDE.md)

- No exclamation points
- No emoji in product copy
- Contractions encouraged
- Calm operator: tell user what we do, not how we feel about it
- Address inbox shame without naming it as shame
- No code glyphs (`</>`, `{...}`) in marketing copy — they read as broken HTML entities to non-developers

## Pre-flight checklist — run before claiming page is done

Inspect via `mcp__Claude_Preview__preview_eval` at viewport 1920×1100:

### Typography

- [ ] Hero h1 computed font-size ≤ 64px
- [ ] Hero h1 wraps to ≤ 4 lines
- [ ] Hero deck font-size: 17px (LEAD)
- [ ] All other body paragraphs: 15px (BODY) — check `.faq-body .a`, `.twoup p`, `.section .sub`, `.steps3 .step p`, dark-section paragraphs
- [ ] Italic accent count ≤ 4 (count `<em>` instances in marketing content; brand wordmark doesn't count)
- [ ] All italic uses `WONK 0` not `WONK 1` (search for `"WONK" 1` and replace)

### Layout

- [ ] Page uses `.container` consistently (max-width 1200px)
- [ ] Hero (if present) uses `.hero-grid` asymmetric pattern
- [ ] Mobile breakpoints behave correctly at 375px (resize and check)

### CSS specificity

- [ ] Any `.cta` inside `.nav .links` uses `.nav .links a.cta` selector
- [ ] Sign-in CTA computed `background: rgb(31, 31, 31)`, `color: rgb(255, 255, 255)`, `padding: 8px 14px`

### Components

- [ ] All favicons use `background: hsl(var(--card))` (white) — no colored bg
- [ ] No fallback letters under favicons
- [ ] No tag/pill overflows its column (test: compare `.tag` offsetWidth to column grid width)
- [ ] Stat-strip cells parse as natural sentences when value + label combined

### Voice / content

- [ ] No exclamation points
- [ ] No emoji
- [ ] No `</>` or similar code glyphs in marketing copy
- [ ] All `<Link>` for internal routes; all `<a target="_blank" rel="noopener">` for external

### Build gates

- [ ] `npm run typecheck` → 0 errors
- [ ] `npm run lint` → 0 errors / 0 warnings
- [ ] `npm run test` → all pass
- [ ] `npm run build` → success
- [ ] Bundle delta < +25 KB gzip total

### Browser preview verification

- [ ] Tested at 1920×1100 desktop (Mac display size — founder's likely viewport)
- [ ] Tested at 375×812 mobile
- [ ] `preview_console_logs --level error` → no errors

## Anti-patterns (don't ship these)

1. Hero h1 font-size > 80px at any viewport
2. Italic with `WONK 1` (use `WONK 0`)
3. Body paragraph sizes other than 15px (or 17px hero deck)
4. Colored background behind favicons
5. Single-letter avatars when real favicons are available
6. > 4 italic accents per page
7. Code glyphs (`</>`, `[...]`) in marketing copy
8. Inverted English in stat phrasing
9. CTA styles defined as `.nav .cta` without the `.links a` parent selector
10. Inline styles in JSX when a CSS class exists (use the class)
11. Speculative dark-mode tokens that aren't reached
12. New marketing classes — first check `src/index.css` and `v2-marketing.css` for canonical patterns

## Lessons learned during Landing port (for context)

These issues were caught only after the page was shipped. The rules above are derived from them:

| #   | Issue                                                                      | Lesson                                                       |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | Hero h1 was 104px at 1920 viewport (5+ line wrap, italic broke mid-phrase) | Test at user's actual viewport, not just IDE preview default |
| 2   | Sign-in CTA had dark grey text + 0 horizontal padding                      | CSS specificity: `.nav .links a` beats `.nav .cta`           |
| 3   | "Never / Do we read your messages"                                         | Inverted English; use quantitative + natural phrasing        |
| 4   | "Checked automatically" tag overflowed 132px column                        | Tag column must fit longest tag; tags ≤ 14 chars             |
| 5   | `</>` glyph in trust strip                                                 | Code glyphs read as broken HTML to non-developers            |
| 6   | Body sizes 13.5/14/15/15.5/16/17                                           | Normalize to LEAD 17 / BODY 15 / SMALL 13.5                  |
| 7   | Two "L" avatars (LinkedIn red, Substack purple)                            | Use real favicons, not single letters                        |
| 8   | Favicon colored bg layered with favicon's own color                        | Favicon container should be neutral white                    |
| 9   | WONK 1 italic on all editorial accents                                     | Use WONK 0 + SOFT 100; reserve italic for differentiators    |
| 10  | 12 italic accents on Landing                                               | ≤ 4 per page                                                 |

Each of these was a separate user QA round. The checklist above is the price of avoiding the next round.
