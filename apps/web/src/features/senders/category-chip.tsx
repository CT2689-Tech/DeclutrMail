'use client';

import { tokens } from '@declutrmail/shared';

const { color, font } = tokens;

/** A Gmail-category filter chip — neutral, with a mono count. */
export function CategoryChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.borderColor = color.fg;
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.borderColor = color.border;
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '5px 11px 5px 12px',
        background: active ? color.fg : color.card,
        color: active ? '#FFFFFF' : color.fg,
        border: `1px solid ${active ? color.fg : color.border}`,
        borderRadius: 9999,
        fontFamily: font.sans,
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'background 0.12s, color 0.12s, border-color 0.12s',
      }}
    >
      <span>{label}</span>
      <span
        style={{
          fontFamily: font.mono,
          fontSize: 10,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: active ? 'rgba(255,255,255,0.85)' : color.fgMuted,
        }}
      >
        {count}
      </span>
    </button>
  );
}
