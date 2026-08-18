// Contract test for the brand logo (D255 + ADR-0036).
//
// The point of this test is to lock the SPECIFICATION, not the markup.
// Four things here are brand decisions that a well-meaning refactor
// would otherwise quietly undo:
//
//   1. the two cuts (heavy geometry at <=24px, regular above),
//   2. the literal hexes (never `var(--dm-*)` — ADR-0036 §Alternatives),
//   3. `duo` auto-inverting while `reversed` / `ink` stay pinned,
//   4. `label={null}` going silent so an `aria-label`ed ancestor link
//      does not read its name twice.
//
// Implementation note: we render via `react-dom/server` rather than
// `@testing-library/react` + jsdom, mirroring `privacy-badge.test.tsx`
// — the shared package has no DOM toolchain wired. The component is
// pure markup, so SSR output is enough.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Logo } from './logo';

const INK = '#0E1413';
const TEAL = '#006B5F';
const MINT = '#79E6DC';
const PAPER = '#FAFAF7';

/** The frame path that only the heavy (<=24px) cut draws. */
const HEAVY_FRAME = 'M44 17H12';
/** The frame path that only the regular (>24px) cut draws. */
const REGULAR_FRAME = 'M45 16H11';

describe('Logo — two cuts (ADR-0036)', () => {
  it('draws the heavy cut at and below 24px', () => {
    for (const size of [16, 20, 24]) {
      const html = renderToStaticMarkup(<Logo variant="mark" size={size} />);
      expect(html, `size=${size}`).toContain(HEAVY_FRAME);
      expect(html, `size=${size}`).not.toContain(REGULAR_FRAME);
      expect(html, `size=${size}`).toContain('stroke-width="7"');
    }
  });

  it('draws the regular cut above 24px', () => {
    for (const size of [25, 27, 28, 64]) {
      const html = renderToStaticMarkup(<Logo variant="mark" size={size} />);
      expect(html, `size=${size}`).toContain(REGULAR_FRAME);
      expect(html, `size=${size}`).not.toContain(HEAVY_FRAME);
      expect(html, `size=${size}`).toContain('stroke-width="5.5"');
    }
  });

  it('swaps geometry rather than scaling one drawing — the viewBox is fixed', () => {
    for (const size of [16, 64]) {
      expect(renderToStaticMarkup(<Logo variant="mark" size={size} />)).toContain(
        'viewBox="-3 -5 71 71"',
      );
    }
  });
});

describe('Logo — colors are brand-locked, never tokenized (ADR-0036)', () => {
  it('emits the literal brand hexes', () => {
    const html = renderToStaticMarkup(<Logo />);
    expect(html).toContain(INK);
    expect(html).toContain(TEAL);
  });

  it('never reads a palette custom property', () => {
    for (const tone of ['duo', 'reversed', 'ink'] as const) {
      const html = renderToStaticMarkup(<Logo tone={tone} />);
      // --dm-font-display is allowed (family, not colour). Any other
      // --dm-* reference would let the palette restyle the mark.
      const tokenRefs = html.match(/var\(--dm-[a-z-]+\)/g) ?? [];
      expect(
        tokenRefs.filter((r) => r !== 'var(--dm-font-display)'),
        `tone=${tone}`,
      ).toEqual([]);
    }
  });
});

describe('Logo — tone inversion', () => {
  it('duo auto-inverts to paper + mint under a dark color-scheme', () => {
    const html = renderToStaticMarkup(<Logo tone="duo" />);
    expect(html).toContain(`light-dark(${INK}, ${PAPER})`);
    expect(html).toContain(`light-dark(${TEAL}, ${MINT})`);
  });

  it('pins reversed and ink through a theme flip', () => {
    const reversed = renderToStaticMarkup(<Logo tone="reversed" />);
    expect(reversed).not.toContain('light-dark(');
    expect(reversed).toContain(PAPER);
    expect(reversed).toContain(MINT);

    const ink = renderToStaticMarkup(<Logo tone="ink" />);
    expect(ink).not.toContain('light-dark(');
    expect(ink).not.toContain(TEAL);
    expect(ink).not.toContain(MINT);
  });

  it('keeps a plain stroke attribute so a browser without light-dark() still draws', () => {
    const html = renderToStaticMarkup(<Logo tone="duo" variant="mark" />);
    expect(html).toContain(`stroke="${INK}"`);
    expect(html).toContain(`stroke="${TEAL}"`);
  });
});

describe('Logo — accessible name', () => {
  it('names itself by default', () => {
    const html = renderToStaticMarkup(<Logo />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="DeclutrMail"');
  });

  it('goes silent for label={null} so an ancestor link is not read twice', () => {
    const html = renderToStaticMarkup(<Logo label={null} />);
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain('aria-label=');
    expect(html).toContain('aria-hidden="true"');
  });

  it('accepts a caller-supplied name', () => {
    expect(renderToStaticMarkup(<Logo label="DeclutrMail home" />)).toContain(
      'aria-label="DeclutrMail home"',
    );
  });

  it('never exposes the inner mark to the accessibility tree', () => {
    // Two `aria-hidden` nodes would be fine; a NAMED svg inside a named
    // span is the double-read bug.
    const html = renderToStaticMarkup(<Logo />);
    expect(html.match(/aria-label=/g)).toHaveLength(1);
  });
});

describe('Logo — wordmark', () => {
  it('splits the word so Mail carries the accent', () => {
    const html = renderToStaticMarkup(<Logo />);
    expect(html).toContain('Declutr<span');
    expect(html).toContain('Mail</span>');
  });

  it('omits the word entirely for the mark variant', () => {
    // Assert on rendered TEXT, not on the raw markup: the default
    // `aria-label` is also the string "DeclutrMail", so a substring
    // check against the HTML passes even when the word is drawn.
    const text = renderToStaticMarkup(<Logo variant="mark" />).replace(/<[^>]*>/g, '');
    expect(text).toBe('');
    expect(renderToStaticMarkup(<Logo />).replace(/<[^>]*>/g, '')).toBe('DeclutrMail');
  });

  it('sets Fraunces 800 at the specified tracking', () => {
    const html = renderToStaticMarkup(<Logo />);
    expect(html).toContain('var(--dm-font-display)');
    expect(html).toContain('font-weight:800');
    expect(html).toContain('letter-spacing:-0.03em');
  });

  it('scales the word from the mark, tighter when stacked', () => {
    expect(renderToStaticMarkup(<Logo size={100} />)).toContain('font-size:87px');
    expect(renderToStaticMarkup(<Logo size={100} variant="stacked" />)).toContain('font-size:52px');
  });
});
