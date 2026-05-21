'use client';

import { tokens } from '@declutrmail/shared';
import type { Pattern } from '../data';

const { color, font } = tokens;

/** Standing behavioural cohorts beneath the three weekly blocs. */
export function PatternsRow({
  patterns,
  onReview,
}: {
  patterns: Pattern[];
  onReview: (id: string) => void;
}) {
  if (patterns.length === 0) return null;

  return (
    <section
      style={{
        background: color.paper,
        border: `1px solid ${color.line}`,
        borderRadius: 14,
        padding: '18px 20px 16px',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              background: color.amberBg,
              color: color.amber,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </span>
          <h2
            style={{
              margin: 0,
              fontFamily: font.sans,
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: '-0.005em',
              color: color.fg,
            }}
          >
            Patterns we noticed
          </h2>
        </div>
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 10,
            color: color.fgMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
          }}
        >
          Standing cohorts · refreshed daily
        </span>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${patterns.length}, minmax(0, 1fr))`,
          gap: 12,
        }}
      >
        {patterns.map((p) => {
          const accent = p.tone === 'warn' ? color.amber : color.primary;
          return (
            <div
              key={p.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '12px 14px',
                background: color.card,
                border: `1px solid ${p.tone === 'warn' ? 'rgba(245,158,11,0.30)' : color.line}`,
                borderRadius: 10,
                minHeight: 138,
              }}
            >
              <div
                style={{
                  fontFamily: font.sans,
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: color.fg,
                  lineHeight: 1.35,
                }}
              >
                <span
                  style={{
                    fontFamily: font.mono,
                    fontVariantNumeric: 'tabular-nums',
                    color: accent,
                    fontWeight: 700,
                    marginRight: 5,
                  }}
                >
                  {p.matches}
                </span>
                senders match:{' '}
                <span style={{ fontWeight: 500, color: color.fgSoft }}>{p.label}</span>
              </div>
              <div
                style={{
                  fontFamily: font.mono,
                  fontSize: 10.5,
                  color: color.fgMuted,
                  lineHeight: 1.5,
                }}
              >
                {p.examples.join(', ')}
                {p.matches > p.examples.length ? `, +${p.matches - p.examples.length} more` : ''}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  marginTop: 'auto',
                }}
              >
                <button
                  onClick={() => onReview(p.id)}
                  style={{
                    padding: '4px 10px',
                    background: 'transparent',
                    color: accent,
                    border: `1px solid ${p.tone === 'warn' ? 'rgba(180,83,9,0.45)' : color.primaryBorder}`,
                    borderRadius: 6,
                    fontFamily: font.sans,
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Review all {p.matches} →
                </button>
                <span
                  style={{
                    fontFamily: font.mono,
                    fontSize: 10.5,
                    color: color.fgMuted,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  saves {p.hours}h /yr
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
