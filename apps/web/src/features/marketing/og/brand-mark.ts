// The brand mark, as a data URI, for Open Graph cards.
//
// Satori cannot consume <Logo> from packages/shared — it renders a subset of
// CSS with no `light-dark()`, no custom properties and no React context — so
// the geometry is repeated here. That duplication is deliberate and is the
// same reason opengraph-image.tsx keeps its own copies of the brand hexes
// (ADR-0036 §Consequences).
//
// The paths below are SPECIFICATION and must match
// packages/shared/src/components/logo.tsx. `scripts/generate-brand-icons.mjs`
// carries the same literals for the raster set; if the geometry ever changes,
// all three move together. ADR-0036 §Two cuts is the source of truth.
//
// OG cards are 1200x630 and the mark draws at 40px+, so this is always the
// REGULAR cut. There is no compact variant here on purpose: a compact cut at
// 40px would be the wrong weight.

const REGULAR = {
  viewBox: '-3 -5 71 71',
  frame: 'M42 16H11a7 7 0 0 0-7 7v20a7 7 0 0 0 7 7h34a7 7 0 0 0 7-7V30',
  tail: 'M7 21.5L30 37.5L61 13.5',
  stroke: 5.5,
} as const;

/**
 * `ink` for the paper card, `reversed` for an ink or teal ground.
 *
 * Returned as a data URI rather than inline JSX: Satori's `<svg>` support is
 * partial, and an `<img>` with a data URI is the path it handles most
 * predictably.
 */
export function ogMarkDataUri(tone: 'ink' | 'reversed' = 'ink'): string {
  const [frameColor, tailColor] =
    tone === 'reversed' ? (['#FAFAF7', '#79E6DC'] as const) : (['#0E1413', '#006B5F'] as const);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${REGULAR.viewBox}" fill="none">` +
    `<path d="${REGULAR.frame}" stroke="${frameColor}" stroke-width="${REGULAR.stroke}" stroke-linecap="round"/>` +
    `<path d="${REGULAR.tail}" stroke="${tailColor}" stroke-width="${REGULAR.stroke}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`;

  // base64 rather than percent-encoding: Satori is stricter about the latter,
  // and the payload is small enough that the size difference does not matter.
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
