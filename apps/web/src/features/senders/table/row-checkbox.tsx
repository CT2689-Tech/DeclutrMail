'use client';

import type { MouseEvent } from 'react';
import { tokens } from '@declutrmail/shared';

const { color } = tokens;

/** Square select control. Passes the native event up for shift-click ranges. */
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
      onClick={(e) => {
        if (!disabled) onChange(!checked, e);
      }}
      style={{
        width: 16,
        height: 16,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        borderRadius: 4,
        border: `1.5px solid ${checked ? color.primary : 'rgba(14,20,19,0.28)'}`,
        background: checked ? color.primary : color.card,
        color: color.fgInverse,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {checked && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </button>
  );
}
