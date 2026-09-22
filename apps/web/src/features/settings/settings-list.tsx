'use client';

import { editorialTitleStyle } from '@/features/editorial/page';

import type { CSSProperties, ReactNode, SelectHTMLAttributes } from 'react';
import Link from 'next/link';
import { Button, tokens } from '@declutrmail/shared';
import { SwitchTrack } from './switch';

const { color, font, text, motion, radius } = tokens;

/**
 * List primitives for Settings and its sub-screens: a titled group is ONE
 * raised surface holding its rows (label left, control / value / chevron
 * right), separated by inset hairlines. One grammar for every preference
 * so a section never needs its own card, heading and paragraph to be
 * understood.
 */

/** Horizontal inset shared by the group title, every row and the footer. */
const ROW_INSET = 16;

/**
 * Page header — one line: the h1 plus optional right-aligned controls.
 * Sub-screens have no sidebar entry, so `backToSettings` is their way out.
 */
export function PageHeader({
  title,
  backToSettings = false,
  children,
}: {
  title: string;
  backToSettings?: boolean;
  children?: ReactNode;
}) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 12,
      }}
    >
      {backToSettings && (
        <Link
          href="/settings"
          aria-label="Back to Settings"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            marginLeft: -8,
            borderRadius: radius.pill,
            color: color.fgMuted,
            transform: 'rotate(180deg)',
          }}
          className="dm-settings-back"
        >
          <style>{`.dm-settings-back { transition: background ${motion.fast} ${motion.ease}; }
.dm-settings-back:hover { background: ${color.fill}; }`}</style>
          <Chevron size={16} />
        </Link>
      )}
      <h1 style={{ ...editorialTitleStyle, minWidth: 0 }}>{title}</h1>
      {children != null && <div style={{ marginLeft: 'auto' }}>{children}</div>}
    </header>
  );
}

/**
 * The quiet label above a group or a section: sans, muted, sentence
 * case. `as="div"` where the surrounding markup already owns the
 * heading outline.
 */
export function GroupTitle({
  as: Tag = 'h2',
  inset = false,
  children,
}: {
  as?: 'h2' | 'div';
  /** Align with the rows of a raised group (which sit 16px inside it). */
  inset?: boolean;
  children: ReactNode;
}) {
  return (
    <Tag
      style={{
        margin: '0 0 8px',
        paddingLeft: inset ? ROW_INSET : 0,
        fontFamily: font.sans,
        fontSize: text.sm,
        fontWeight: 600,
        color: color.fgMuted,
      }}
    >
      {children}
    </Tag>
  );
}

export function SettingsGroup({
  id,
  title,
  focusable = false,
  children,
  footer,
  style,
}: {
  /** Anchor id — emails and OAuth returns deep-link to these. */
  id?: string;
  title: string;
  /** Lets a deep link move keyboard focus to the group. */
  focusable?: boolean;
  children: ReactNode;
  /** Rendered under the rows — a failed-save line, a limit note. */
  footer?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      id={id}
      tabIndex={focusable ? -1 : undefined}
      aria-label={title}
      style={{ scrollMarginTop: 24, fontFamily: font.sans, ...style }}
    >
      <GroupTitle inset>{title}</GroupTitle>
      <style>{GROUP_CSS}</style>
      <div
        className="dm-settings-rows"
        style={{
          background: color.card,
          border: `1px solid ${color.border}`,
          borderRadius: radius.xl,
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
      {footer != null && <div style={{ padding: `0 ${ROW_INSET}px` }}>{footer}</div>}
    </section>
  );
}

/**
 * Every row draws an inset hairline above itself; the first row of a
 * group (direct child, or first inside a wrapping card component) hides
 * it, so the raised surface has no line against its own edge.
 */
const GROUP_CSS = `.dm-settings-row { position: relative; }
.dm-settings-row::before { content: ''; position: absolute; top: 0; left: ${ROW_INSET}px; right: 0; height: 1px; background: ${color.lineSoft}; }
.dm-settings-rows > .dm-settings-row:first-child::before,
.dm-settings-rows > :first-child > .dm-settings-row:first-child::before { display: none; }
.dm-settings-drill { transition: background ${motion.fast} ${motion.ease}; }
.dm-settings-drill:hover { background: ${color.fill}; }`;

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 12,
  minHeight: 56,
  padding: `0 ${ROW_INSET}px`,
  boxSizing: 'border-box',
} as const;

export function SettingsRow({
  label,
  detail,
  children,
  style,
}: {
  label: ReactNode;
  /** Optional secondary line — keep it to a handful of words. */
  detail?: ReactNode;
  /** Right-hand control or value. */
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className="dm-settings-row" style={{ ...rowStyle, ...style }}>
      <div style={{ minWidth: 0, flex: '1 1 200px', padding: '10px 0' }}>
        <div style={{ fontSize: text.md, fontWeight: 500, color: color.fg }}>{label}</div>
        {detail != null && (
          <div style={{ fontSize: text.sm, color: color.fgMuted, marginTop: 2 }}>{detail}</div>
        )}
      </div>
      {children != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {children}
        </div>
      )}
    </div>
  );
}

/** A row that drills into another page: label, optional value, chevron. */
export function DrillRow({
  href,
  label,
  value,
}: {
  href: string;
  label: string;
  value?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="dm-settings-row dm-settings-drill"
      style={{ ...rowStyle, flexWrap: 'nowrap', textDecoration: 'none', color: color.fg }}
    >
      <span style={{ fontSize: text.md, fontWeight: 500, minWidth: 0 }}>{label}</span>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontSize: text.md,
          color: color.fgMuted,
          minWidth: 0,
        }}
      >
        {value}
        <Chevron />
      </span>
    </Link>
  );
}

function Chevron({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

/** Loading / failed read for a whole group — one row, never a dead page. */
export function SettingsRowStatus({
  state,
  loadingLabel,
  errorLabel,
}: {
  state: { kind: 'loading' } | { kind: 'error'; onRetry: () => void };
  loadingLabel: string;
  errorLabel: string;
}) {
  if (state.kind === 'loading') {
    return (
      <div className="dm-settings-row" style={rowStyle}>
        <span role="status" style={{ fontSize: text.md, color: color.fgMuted }}>
          {loadingLabel}
        </span>
      </div>
    );
  }
  return (
    <div className="dm-settings-row" style={rowStyle}>
      <span style={{ fontSize: text.md, color: color.danger }}>{errorLabel}</span>
      <Button tone="default" size="sm" onClick={state.onRetry}>
        Retry
      </Button>
    </div>
  );
}

/** Inline failed-save line under a group's rows. */
export function SettingsSaveError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" style={{ fontSize: text.sm, color: color.danger, margin: '8px 0 0' }}>
      {children}
    </p>
  );
}

/**
 * Switch with a short state word beside it ("On" / "Off" / "Saving…").
 * The word is what makes an in-flight save visible; the knob alone
 * would flip optimistically and say nothing.
 */
export function SettingsSwitch({
  ariaLabel,
  on,
  stateLabel,
  disabled,
  pending,
  onToggle,
}: {
  ariaLabel: string;
  on: boolean;
  stateLabel: string;
  disabled: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      onClick={onToggle}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        minHeight: 44,
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled && !pending ? 0.45 : 1,
        fontFamily: font.sans,
      }}
    >
      <span style={{ fontSize: text.sm, color: color.fgMuted, minWidth: 48, textAlign: 'right' }}>
        {pending ? 'Saving…' : stateLabel}
      </span>
      <SwitchTrack on={on} />
    </button>
  );
}

/**
 * A native `<select>` drawn as a capsule well: neutral fill, no outline,
 * a muted chevron on the right. Native so keyboard, screen readers and
 * the phone picker all behave exactly as before.
 */
export function SelectWell({
  style,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { style?: CSSProperties }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <style>{`.dm-select-well { transition: background ${motion.fast} ${motion.ease}; }
.dm-select-well:hover:not(:disabled) { background: ${color.fillHover}; }
.dm-select-well:focus-visible { outline: 2px solid ${color.primary}; outline-offset: 2px; }`}</style>
      <select
        {...props}
        className="dm-select-well"
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          fontFamily: font.sans,
          fontSize: text.md,
          fontWeight: 500,
          fontVariantNumeric: 'tabular-nums',
          color: color.fg,
          background: color.fill,
          border: 'none',
          borderRadius: radius.pill,
          height: 36,
          padding: '0 34px 0 14px',
          boxSizing: 'border-box',
          cursor: props.disabled ? 'default' : 'pointer',
          opacity: props.disabled ? 0.6 : 1,
          ...style,
        }}
      >
        {children}
      </select>
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          right: 12,
          display: 'inline-flex',
          color: color.fgMuted,
          pointerEvents: 'none',
          transform: 'rotate(90deg)',
        }}
      >
        <Chevron size={12} />
      </span>
    </span>
  );
}
