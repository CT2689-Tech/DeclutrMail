'use client';

import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { Button, tokens } from '@declutrmail/shared';

const { color, font, text, motion, radius } = tokens;

/**
 * List primitives for Settings and its sub-screens: a titled group of
 * hairline-separated rows (label left, control / value / chevron right).
 * One grammar for every preference so a section never needs its own
 * card, heading and paragraph to be understood.
 */

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
            width: 32,
            height: 32,
            marginLeft: -8,
            borderRadius: radius.md,
            color: color.fgMuted,
            transform: 'rotate(180deg)',
          }}
        >
          <Chevron />
        </Link>
      )}
      <h1
        style={{
          margin: 0,
          fontFamily: font.sans,
          fontSize: text['2xl'],
          fontWeight: 600,
          letterSpacing: '-0.01em',
          color: color.fg,
          minWidth: 0,
        }}
      >
        {title}
      </h1>
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
  children,
}: {
  as?: 'h2' | 'div';
  children: ReactNode;
}) {
  return (
    <Tag
      style={{
        margin: '0 0 4px',
        fontFamily: font.sans,
        fontSize: text.sm,
        fontWeight: 500,
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
      <GroupTitle>{title}</GroupTitle>
      <style>{`.dm-settings-drill { transition: background ${motion.fast} ${motion.ease}; }
.dm-settings-drill:hover { background: ${color.lineSoft}; }`}</style>
      {/* Every row draws its own top hairline, so the first row's is the
          group's top edge and the container only closes the bottom. */}
      <div style={{ borderBottom: `1px solid ${color.line}` }}>{children}</div>
      {footer}
    </section>
  );
}

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 12,
  minHeight: 44,
  padding: 0,
  boxSizing: 'border-box',
  borderTop: `1px solid ${color.line}`,
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
    <div style={{ ...rowStyle, ...style }}>
      <div style={{ minWidth: 0, flex: '1 1 200px', padding: '8px 0' }}>
        <div style={{ fontSize: text.md, color: color.fg }}>{label}</div>
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
      className="dm-settings-drill"
      style={{ ...rowStyle, flexWrap: 'nowrap', textDecoration: 'none', color: color.fg }}
    >
      <span style={{ fontSize: text.md, minWidth: 0 }}>{label}</span>
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

function Chevron() {
  return (
    <svg
      width={14}
      height={14}
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
      <div style={rowStyle}>
        <span role="status" style={{ fontSize: text.md, color: color.fgMuted }}>
          {loadingLabel}
        </span>
      </div>
    );
  }
  return (
    <div style={rowStyle}>
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
    <p role="alert" style={{ fontSize: text.sm, color: color.danger, margin: '6px 0 0' }}>
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
        gap: 8,
        minHeight: 44,
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled && !pending ? 0.6 : 1,
        fontFamily: font.sans,
      }}
    >
      <span style={{ fontSize: text.sm, color: color.fgMuted, minWidth: 48, textAlign: 'right' }}>
        {pending ? 'Saving…' : stateLabel}
      </span>
      <span
        aria-hidden="true"
        style={{
          width: 36,
          height: 22,
          borderRadius: radius.pill,
          background: on ? color.primary : color.mutedBg,
          border: `1px solid ${on ? color.primary : color.border}`,
          position: 'relative',
          transition: `background ${motion.fast} ${motion.ease}`,
          flexShrink: 0,
          boxSizing: 'border-box',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: on ? 16 : 2,
            width: 16,
            height: 16,
            borderRadius: radius.pill,
            background: on ? color.fgInverse : color.fgMuted,
            transition: `left ${motion.fast} ${motion.ease}`,
          }}
        />
      </span>
    </button>
  );
}
