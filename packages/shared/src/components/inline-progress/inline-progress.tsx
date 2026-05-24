'use client';

import type { CSSProperties, ReactNode } from 'react';
import { color, font } from '../../tokens/tokens';

/**
 * Inline action progress (D166 — "action click → inline progress on
 * button or row").
 *
 * Renders a small spinner sized to sit next to a button label without
 * resizing the button. Two layouts:
 *
 *   - `mode="inline"` (default): spinner shows on a `position: absolute`
 *     overlay on top of the button content, which is hidden via
 *     `visibility: hidden` so the button keeps its measured width.
 *     This is the D166 "preserves layout" requirement — the page does
 *     not reflow when a destructive action is in flight.
 *   - `mode="trailing"`: spinner sits AFTER the children with a gap.
 *     Used when the parent wants both label and spinner visible
 *     simultaneously (status pills, row-level progress).
 *
 * The component does NOT render a button — it renders the spinner and
 * label container. Consumers wrap their own `<button disabled>`
 * around it so the focus management, click handler, and a11y semantics
 * stay with the host control.
 *
 * Per CLAUDE.md §10 "fake completion": the spinner reflects a real
 * in-flight mutation, not a hardcoded delay. The `pending` prop is
 * meant to flow from `useMutation().isPending` (or equivalent).
 */
export interface InlineProgressProps {
  /** Whether an action is currently in flight. */
  pending: boolean;
  /** Label / icon to show in the idle state. */
  children: ReactNode;
  /** Layout strategy. Default `inline` (overlay). */
  mode?: 'inline' | 'trailing';
  /** Spinner diameter in px. Default 12. */
  size?: number;
  /** Accessible label announced when `pending` is true. Default "Working". */
  pendingLabel?: string;
  style?: CSSProperties;
}

export function InlineProgress({
  pending,
  children,
  mode = 'inline',
  size = 12,
  pendingLabel = 'Working',
  style,
}: InlineProgressProps) {
  if (mode === 'trailing') {
    return (
      <span
        data-dm-inline-progress="trailing"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: font.sans,
          ...style,
        }}
      >
        {children}
        {pending ? <Spinner size={size} label={pendingLabel} /> : null}
      </span>
    );
  }

  // Inline overlay — keep the children laid out but invisible while
  // pending, so the host button preserves its measured width.
  return (
    <span
      data-dm-inline-progress="inline"
      aria-busy={pending}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: font.sans,
        ...style,
      }}
    >
      <span style={{ visibility: pending ? 'hidden' : 'visible' }}>{children}</span>
      {pending ? (
        <span
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Spinner size={size} label={pendingLabel} />
        </span>
      ) : null}
    </span>
  );
}

// ── internals ──────────────────────────────────────────────────────

function Spinner({ size, label }: { size: number; label: string }) {
  const border = Math.max(1.5, size / 8);
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label}
      data-dm-spinner
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        border: `${border}px solid ${color.line}`,
        borderTopColor: color.primary,
        borderRadius: '50%',
        animation: 'dm-spin 0.7s linear infinite',
      }}
    />
  );
}
