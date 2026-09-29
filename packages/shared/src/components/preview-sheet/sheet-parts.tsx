'use client';

import { useId, type ReactNode } from 'react';
import { color, font, motion, radius, shadow, space, text } from '../../tokens/tokens';

/*
 * The small pieces a confirm surface is built from — the count-changing
 * choice, the Details fact list and its link row. Their own module, apart
 * from `PreviewSheet`: an INLINE preview (Screener's decide row, Triage's
 * skip-sheet path) uses these without the modal, and tree-shaking is
 * per-module, so keeping them in the sheet's file pulled the whole modal
 * into routes that never open one.
 */

/**
 * A two-or-three way choice that changes the sheet's count ("Inbox only /
 * Inbox + archived"). Render it only when the options give DIFFERENT
 * counts — a chooser whose options agree is noise.
 */
export function SheetSegmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; count?: number | undefined; disabled?: boolean }[];
  onChange: (next: T) => void;
}) {
  const labelId = useId();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
      {/* Visible: a choice whose options say "them" needs to name what
        "them" is. It also names the group for assistive tech. */}
      <span id={labelId} style={{ fontSize: text.sm, color: color.fgMuted }}>
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        style={{
          display: 'grid',
          gridAutoFlow: 'column',
          gridAutoColumns: '1fr',
          gap: 2,
          padding: 3,
          borderRadius: radius.pill,
          background: color.fill,
        }}
      >
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={opt.disabled}
              onClick={() => onChange(opt.value)}
              style={{
                minHeight: 38,
                padding: `0 ${space[3]}px`,
                border: 'none',
                borderRadius: radius.pill,
                background: selected ? color.card : 'transparent',
                boxShadow: selected ? shadow.card : 'none',
                color: selected ? color.fg : color.fgSoft,
                fontFamily: font.sans,
                fontSize: text.sm,
                fontWeight: selected ? 600 : 500,
                cursor: opt.disabled ? 'not-allowed' : 'pointer',
                opacity: opt.disabled ? 0.45 : 1,
                whiteSpace: 'nowrap',
                transition: `background ${motion.fast} ${motion.ease}, color ${motion.fast} ${motion.ease}`,
              }}
            >
              {opt.label}
              {opt.count != null && (
                <span
                  style={{
                    marginLeft: 6,
                    color: color.fgMuted,
                    fontWeight: 500,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {opt.count.toLocaleString('en-US')}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** One row of {@link SheetFactList}: a short label and a short value. */
export type SheetFactItem = { label: string; value: ReactNode };

/**
 * The Details well's facts as a two-column list — label left (muted,
 * never wraps), value right (full contrast, wraps). A reader scans the
 * labels and reads only the value they came for, which a stack of full
 * sentences never allowed.
 *
 * Stacks label-over-value on narrow wells with no media query: the value
 * asks for 200px, so once the label column plus that no longer fit (a
 * phone under ~420px) flex-wrap drops it to its own line. Pure CSS, so
 * there is no post-hydration jump.
 */
export function SheetFactList({
  facts,
  'aria-label': ariaLabel,
}: {
  facts: readonly SheetFactItem[];
  'aria-label'?: string;
}) {
  if (facts.length === 0) return null;
  return (
    <dl aria-label={ariaLabel} style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
      {facts.map((fact, i) => (
        <div
          key={fact.label}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            columnGap: space[3],
            rowGap: 2,
            padding: `11px 0`,
            borderTop: i === 0 ? 'none' : `1px solid ${color.lineSoft}`,
          }}
        >
          <dt
            style={{
              flex: '0 0 38%',
              minWidth: 0,
              fontSize: text.sm,
              color: color.fgMuted,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {fact.label}
          </dt>
          <dd
            style={{
              flex: '1 1 200px',
              minWidth: 0,
              margin: 0,
              fontSize: text.sm,
              fontWeight: 500,
              color: color.fg,
              fontVariantNumeric: 'tabular-nums',
              overflowWrap: 'anywhere',
            }}
          >
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The Details well's links ("Check in Gmail ↗", "Show 5 of 6,728") on a
 * row of their own at the bottom — quiet text buttons, never mixed into
 * the facts.
 */
export function SheetLinks({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: space[4],
        rowGap: space[1],
      }}
    >
      {children}
    </div>
  );
}

const sheetTextActionStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  minHeight: 32,
  padding: 0,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  fontFamily: font.sans,
  fontSize: text.sm,
  fontWeight: 550,
  color: color.fg,
  textDecoration: 'none',
} as const;

/** A quiet text button for {@link SheetLinks}: a link when `href` is set, else a button. */
export function SheetTextAction({
  children,
  href,
  onClick,
  title,
  expanded,
}: {
  children: ReactNode;
  href?: string | undefined;
  onClick?: (() => void) | undefined;
  title?: string | undefined;
  /** `aria-expanded` for a show/hide toggle. */
  expanded?: boolean | undefined;
}) {
  if (href !== undefined) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        style={sheetTextActionStyle}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-expanded={expanded}
      style={sheetTextActionStyle}
    >
      {children}
    </button>
  );
}
