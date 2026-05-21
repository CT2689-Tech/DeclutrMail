'use client';

import { tokens } from '@declutrmail/shared';

const { color, font } = tokens;

export interface Stat {
  label: string;
  value: string;
  sub?: string;
}

/** Three compact value-then-label cells inside a weekly-hero bloc. */
export function StatStrip({ items }: { items: Stat[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 10,
        margin: '12px 0 14px',
        padding: '10px 12px',
        background: color.paper,
        border: `1px solid ${color.line}`,
        borderRadius: 9,
      }}
    >
      {items.map((it, i) => (
        <div
          key={it.label}
          style={{
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            borderRight: i < items.length - 1 ? `1px solid ${color.lineSoft}` : 'none',
            paddingRight: i < items.length - 1 ? 10 : 0,
          }}
        >
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 9.5,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: color.fgMuted,
              marginBottom: 3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {it.label}
          </span>
          <span
            style={{
              fontFamily: font.display,
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: '-0.014em',
              color: color.fg,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {it.value}
          </span>
          {it.sub != null && (
            <span
              style={{
                fontFamily: font.mono,
                fontSize: 10,
                color: color.fgMuted,
                marginTop: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {it.sub}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
