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
 * Inbox + archived"). Counts are a preview snapshot; callers explain when
 * distinct scopes currently match instead of silently changing the chosen reach.
 */
export function SheetSegmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly {
    value: T;
    label: string;
    count?: number | undefined;
    disabled?: boolean;
  }[];
  onChange: (next: T) => void;
}) {
  const labelId = useId();
  const tabStop =
    options.find((option) => option.value === value && !option.disabled) ??
    options.find((option) => !option.disabled);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
      {/* Visible: a choice whose options say "them" needs to name what
        "them" is. It also names the group for assistive tech. */}
      <span id={labelId} style={{ fontSize: text.sm, color: color.fgMuted }}>
        {label}
      </span>
      <div
        role="radiogroup"
        className="dm-sheet-segment-group"
        data-option-count={options.length}
        aria-labelledby={labelId}
        style={{
          display: 'grid',
          gridAutoColumns: '1fr',
          gap: 2,
          padding: 3,
          background: color.fill,
        }}
      >
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              className="dm-sheet-segment-option"
              role="radio"
              aria-checked={selected}
              tabIndex={opt === tabStop ? 0 : -1}
              disabled={opt.disabled}
              onClick={() => onChange(opt.value)}
              onKeyDown={(event) => {
                const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
                const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
                if (!forward && !backward && event.key !== 'Home' && event.key !== 'End') return;
                event.preventDefault();
                const enabled = options.filter((option) => !option.disabled);
                const current = enabled.findIndex((option) => option.value === opt.value);
                const nextIndex =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? enabled.length - 1
                      : (current + (forward ? 1 : -1) + enabled.length) % enabled.length;
                const next = enabled[nextIndex];
                if (!next) return;
                onChange(next.value);
                const radios =
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    'button:not([disabled])',
                  );
                radios?.[nextIndex]?.focus();
              }}
              style={{
                minHeight: 44,
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
                minWidth: 0,
                overflowWrap: 'anywhere',
                whiteSpace: 'normal',
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

/**
 * One yes/no choice in a confirm sheet. Unchecked is the safe scope.
 * Callers disable it when the checked scope cannot be counted.
 */
export function SheetCheckbox({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 10,
        width: '100%',
        minHeight: 48,
        padding: `${space[2]}px ${space[4]}px`,
        background: color.fill,
        border: 'none',
        borderRadius: radius.lg,
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        fontFamily: font.sans,
        fontSize: text.sm,
        color: color.fg,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 18,
          height: 18,
          borderRadius: 6,
          boxShadow: checked ? 'none' : `inset 0 0 0 1.5px ${color.fgMuted}`,
          background: checked ? color.primary : 'transparent',
          color: color.fgInverse,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {checked && (
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </span>
      <span>{label}</span>
    </button>
  );
}

/** One row of {@link SheetFactList}: a short label and a short value. */
export type SheetFactItem = { label: string; value: ReactNode };

/**
 * The Details well's facts as a two-column list — label left (muted,
 * wraps in full), value right (full contrast, wraps). A reader scans the
 * labels and reads only the value they came for, which a stack of full
 * sentences never allowed.
 *
 * Stacks label-over-value on narrow wells with no media query: the value
 * asks for 200px, so once the label's 110px plus that no longer fit (a
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
            rowGap: space[1],
            padding: `${space[3]}px 0`,
            borderTop: i === 0 ? 'none' : `1px solid ${color.lineSoft}`,
          }}
        >
          <dt
            style={{
              flex: '1 1 110px',
              minWidth: 0,
              fontSize: text.sm,
              color: color.fgMuted,
              overflowWrap: 'anywhere',
            }}
          >
            {fact.label}
          </dt>
          <dd
            style={{
              flex: '2 1 200px',
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
  fontWeight: 500,
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
        className="dm-external-link"
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
