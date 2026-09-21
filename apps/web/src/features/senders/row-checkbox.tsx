'use client';

import type { MouseEvent } from 'react';
import { tokens } from '@declutrmail/shared';

const { color } = tokens;

/**
 * Square select control. Passes the native event up for shift-click ranges.
 *
 * The button is the HIT AREA (28px, 44px on touch via `.dm-row-check` in
 * `sender-list.tsx`); the 20px box inside it is only the drawing.
 */
export function RowCheckbox({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  /** The row's action is still running — it cannot join a selection. */
  disabled?: boolean;
  checked: boolean;
  onChange: (next: boolean, evt: MouseEvent) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      // aria-disabled, not `disabled`: a bulk confirm returns focus to the
      // checkbox last clicked, and a natively disabled control drops it to <body>.
      aria-disabled={disabled || undefined}
      className="dm-row-check"
      onClick={(e) => {
        if (!disabled) onChange(!checked, e);
      }}
      style={{
        width: 28,
        height: 28,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        border: 'none',
        background: 'transparent',
        // Never dimmed: it stays focusable, so it must stay visible. The
        // row's tint and status say "busy"; the cursor says "not now".
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 20,
          height: 20,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
          border: `1.5px solid ${checked ? color.primary : color.border}`,
          background: checked ? color.primary : color.card,
          color: color.fgInverse,
        }}
      >
        {checked && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
    </button>
  );
}
