// packages/shared/src/components/logo.tsx
//
// Pre-promoted to packages/shared/ per ADR-0007 §Decision 2 (spec
// override): brand-locked surface, and ADR-0036 names >=2 consumers.
// Consumers:
//   - apps/web/src/features/marketing/public-shell/public-shell.tsx (header + footer)
//   - apps/web/src/features/marketing/legal-layout.tsx
//
// Shape locked at promotion. The geometry, stroke weights and colors
// below are the brand specification — changing any of them requires an
// ADR, not a prop. See ADR-0036 for the Never list.
//
// The hexes are LITERALS, deliberately. Every other component in this
// package reads `tokens.color.*` (which are `var(--dm-*)` references)
// so it re-themes when the palette moves. The logo must NOT: ADR-0017
// is the precedent that the palette does move, and a mark that follows
// it is no longer a mark. See ADR-0036 §Alternatives.

/** horizontal (default) | stacked for square crops | mark alone */
export type LogoVariant = 'horizontal' | 'stacked' | 'mark';

/**
 * `duo` — ink frame + teal accent on light, auto-inverting to paper +
 * mint under `[data-theme='dark']`. This is the default and the right
 * answer for any surface that themes.
 *
 * `reversed` / `ink` PIN the pair regardless of theme. Use them only
 * where the background is fixed independently of the user's theme —
 * an always-teal card, a one-colour print/email export.
 */
export type LogoTone = 'duo' | 'reversed' | 'ink';

const INK = '#0E1413';
const TEAL = '#006B5F';
const MINT = '#79E6DC';
const PAPER = '#FAFAF7';

/**
 * Each tone resolves to a `[light, dark]` pair. `duo` differs between
 * the two; `reversed` and `ink` repeat themselves, which is how they
 * stay pinned through a theme flip.
 *
 * These become `light-dark()` expressions, keyed off `color-scheme` —
 * which `styles/tokens.css` already sets to `light` on `:root` and
 * `dark` under `[data-theme='dark']`. That makes the inversion pure
 * CSS: no client component, no `document` read, and no wrong-tone
 * flash before hydration on the statically-rendered marketing shell.
 */
const TONES: Record<LogoTone, { frame: [string, string]; accent: [string, string] }> = {
  duo: { frame: [INK, PAPER], accent: [TEAL, MINT] },
  reversed: { frame: [PAPER, PAPER], accent: [MINT, MINT] },
  ink: { frame: [INK, INK], accent: [INK, INK] },
};

const pair = ([light, dark]: [string, string]) =>
  light === dark ? light : `light-dark(${light}, ${dark})`;

/**
 * The mark is drawn at two cuts, swapped on `size` rather than scaling one
 * drawing down (ADR-0036).
 *
 * The compact cut is not the regular cut thickened. It carries a wider
 * break and a longer corner radius so the tail passes through the opening
 * without touching either frame cap. That clearance is measurable, and
 * `logo.test.tsx` measures it — including the regular cut's known -0.33u
 * * Both cuts clear at both caps. The regular cut was welded too until D255
 * measured it (-0.33u); it is corrected here rather than carried as debt,
 * because nothing had shipped it and it measures better at every size.
 */
function Mark({ size, tone }: { size: number; tone: LogoTone }) {
  const c = TONES[tone];
  const heavy = size <= 24;
  return (
    <svg
      viewBox="-3 -5 71 71"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none', display: 'block' }}
    >
      <path
        d={
          heavy
            ? 'M40 18H13a9 9 0 0 0-9 9v14a9 9 0 0 0 9 9h30a9 9 0 0 0 9-9V30'
            : 'M42 16H11a7 7 0 0 0-7 7v20a7 7 0 0 0 7 7h34a7 7 0 0 0 7-7V30'
        }
        // The attribute is the fallback: a browser without `light-dark()`
        // drops the style declaration and lands on the light pair rather
        // than on `none`.
        stroke={c.frame[0]}
        style={{ stroke: pair(c.frame) }}
        strokeWidth={heavy ? 7 : 5.5}
        strokeLinecap="round"
      />
      <path
        d={heavy ? 'M8 24L28 38L58 14' : 'M7 21.5L30 37.5L61 13.5'}
        stroke={c.accent[0]}
        style={{ stroke: pair(c.accent) }}
        strokeWidth={heavy ? 7 : 5.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface LogoProps {
  variant?: LogoVariant;
  tone?: LogoTone;
  /** Mark height in px. Wordmark scales from it. Default 28. */
  size?: number;
  /**
   * Accessible name. Pass `null` when an ancestor link already names it
   * (e.g. `<Link aria-label="DeclutrMail home">`) to avoid double-reading.
   */
  label?: string | null;
  className?: string;
}

export function Logo({
  variant = 'horizontal',
  tone = 'duo',
  size = 28,
  label = 'DeclutrMail',
  className,
}: LogoProps) {
  const c = TONES[tone];
  const wordSize = variant === 'stacked' ? size * 0.52 : size * 0.87;

  const a11y =
    label === null
      ? { 'aria-hidden': true as const }
      : { role: 'img' as const, 'aria-label': label };

  const shell = {
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    lineHeight: 1,
  };

  if (variant === 'mark') {
    return (
      <span className={className} style={shell} {...a11y}>
        <Mark size={size} tone={tone} />
      </span>
    );
  }

  return (
    <span
      className={className}
      style={{
        ...shell,
        flexDirection: variant === 'stacked' ? 'column' : 'row',
        gap: size * 0.3,
      }}
      {...a11y}
    >
      <Mark size={size} tone={tone} />
      <span
        style={{
          // Fraunces, loaded by next/font as --dm-font-display. The
          // family is a token reference; the COLOR is not.
          fontFamily: 'var(--dm-font-display)',
          fontWeight: 800,
          letterSpacing: '-0.03em',
          whiteSpace: 'nowrap',
          fontSize: wordSize,
          color: pair(c.frame),
        }}
      >
        Declutr<span style={{ color: pair(c.accent) }}>Mail</span>
      </span>
    </span>
  );
}
