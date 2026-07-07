'use client';

import type { MouseEvent } from 'react';
import { tokens } from '@declutrmail/shared';

const { color } = tokens;

/** Square select control. Passes the native event up for shift-click ranges. */
export function RowCheckbox({
  checked,
  onChange,
  ariaLabel,
}: {
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
      onClick={(e) => onChange(!checked, e)}
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
        cursor: 'pointer',
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
