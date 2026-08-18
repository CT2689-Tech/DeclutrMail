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
const HEAVY_FRAME = 'M40 18H13';
/** The frame path that only the regular (>24px) cut draws. */
const REGULAR_FRAME = 'M42 16H11';

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

// --- Clearance: the defect D255 found, and the one it knowingly ships ---
//
// The problem was never "the small cut looks heavy". It was that the teal
// tail's stroke INTERSECTED the frame's lower-right cap, fusing two paths
// into one closed shape. An overlap does not resolve by scaling, so until
// the geometry changed, no size rendered an open envelope.
//
// Clearance = minimum centreline distance from the tail to a frame
// endpoint, minus one stroke width (half a round cap on each side).
// Negative means the strokes overlap.
//
// Measured from the paths the component ACTUALLY renders, pulled back out
// of the markup. Path literals copied into this file would pass forever
// while logo.tsx drifted underneath them.

type Point = [number, number];

/** Narrows an indexed read, and names what was missing when a path is malformed. */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`logo geometry: expected ${what}`);
  return value;
}

/** Endpoint of every command in a subpath, in order. */
function pathPoints(d: string): Point[] {
  // Relative arcs need no arc maths: `a rx ry rot laf sf dx dy` ends at
  // current + (dx, dy). Only endpoints bear on clearance, never the curve
  // between them.
  const points: Point[] = [];
  let x = 0;
  let y = 0;
  for (const token of d.match(/[MLHVAmlhva][^MLHVAmlhva]*/g) ?? []) {
    const n = (token.slice(1).match(/-?\d*\.?\d+/g) ?? []).map(Number);
    switch (token[0]) {
      case 'M':
      case 'L':
        [x, y] = [must(n[0], 'x'), must(n[1], 'y')];
        break;
      case 'm':
      case 'l':
        [x, y] = [x + must(n[0], 'dx'), y + must(n[1], 'dy')];
        break;
      case 'H':
        x = must(n[0], 'x');
        break;
      case 'h':
        x += must(n[0], 'dx');
        break;
      case 'V':
        y = must(n[0], 'y');
        break;
      case 'v':
        y += must(n[0], 'dy');
        break;
      case 'a':
        [x, y] = [x + must(n[5], 'arc dx'), y + must(n[6], 'arc dy')];
        break;
      case 'A':
        [x, y] = [must(n[5], 'arc x'), must(n[6], 'arc y')];
        break;
    }
    points.push([x, y]);
  }
  return points;
}

/** Exact point-to-polyline distance — the tail is straight segments. */
function distanceToPolyline([px, py]: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const [ax, ay] = must(poly[i], `vertex ${i}`);
    const [bx, by] = must(poly[i + 1], `vertex ${i + 1}`);
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
    best = Math.min(best, Math.hypot(px - (ax + t * vx), py - (ay + t * vy)));
  }
  return best;
}

/** Renders the mark at `size`, then measures both frame caps against the drawn tail. */
function clearanceAt(size: number) {
  const html = renderToStaticMarkup(<Logo variant="mark" size={size} />);
  const drawn = [...html.matchAll(/\sd="([^"]+)"/g)].map((m) => must(m[1], 'path data'));
  expect(drawn, `size=${size} draws frame + tail`).toHaveLength(2);

  const stroke = Number(must(/stroke-width="([\d.]+)"/.exec(html)?.[1], 'stroke-width'));
  const frame = pathPoints(must(drawn[0], 'frame path'));
  const tail = pathPoints(must(drawn[1], 'tail path'));

  return {
    stroke,
    upper: distanceToPolyline(must(frame[0], 'frame start'), tail) - stroke,
    lower: distanceToPolyline(must(frame[frame.length - 1], 'frame end'), tail) - stroke,
  };
}

describe('Logo — tail/frame clearance (ADR-0036 §Two cuts)', () => {
  it('holds the compact cut open at both caps', () => {
    const { stroke, upper, lower } = clearanceAt(16);
    expect(stroke).toBe(7);
    // The sign is the decision; the figures are the spec it was locked at.
    expect(upper).toBeGreaterThan(0);
    expect(lower).toBeGreaterThan(0);
    expect(upper).toBeCloseTo(1.121, 2);
    expect(lower).toBeCloseTo(1.746, 2);
  });

  it('holds the regular cut open at both caps', () => {
    // This cut was welded too (-0.33u at the lower cap) and was briefly
    // going to ship that way as accepted debt. It was corrected instead:
    // nothing consumed it yet, and it measures better at every size.
    const { stroke, upper, lower } = clearanceAt(64);
    expect(stroke).toBe(5.5);
    expect(upper).toBeGreaterThan(0);
    expect(lower).toBeGreaterThan(0);
    expect(upper).toBeCloseTo(4.154, 2);
    expect(lower).toBeCloseTo(2.037, 2);
  });
});
