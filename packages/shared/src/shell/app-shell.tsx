'use client';

import type { ReactNode } from 'react';
import { color, font } from '../tokens/tokens';
import { Sidebar } from './sidebar';

const TRUST_CLAIMS = [
  { label: 'Nothing deleted', title: 'Every action is reversible inside Gmail for 7 days.' },
  {
    label: 'Reversible for 7 days',
    title: 'Open Activity to revert any single sender or a bulk action.',
  },
  {
    label: 'Read-only OAuth',
    title: 'We act on labels and message states — never read message bodies.',
  },
];

/**
 * App chrome: fixed sidebar + a topbar trust strip + a scrollable
 * content area. Routing-agnostic — the host app supplies `active` and
 * `onNavigate` (e.g. wired to the Next.js router).
 */
export function AppShell({
  active,
  onNavigate,
  counts,
  children,
}: {
  active: string;
  onNavigate: (id: string) => void;
  counts?: Partial<Record<string, string | number>>;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100vh',
        background: color.bg,
        color: color.fg,
        fontFamily: font.sans,
        overflow: 'hidden',
      }}
    >
      <Sidebar active={active} onNavigate={onNavigate} counts={counts ?? {}} />

      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Topbar — trust strip. Each claim links to the Activity log. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: '8px 16px',
            borderBottom: `1px solid ${color.border}`,
            background: color.card,
            flexShrink: 0,
            fontFamily: font.mono,
            fontSize: 9.5,
            textTransform: 'uppercase',
            letterSpacing: '0.14em',
            color: color.fgMuted,
          }}
        >
          {TRUST_CLAIMS.map((claim, i) => (
            <span
              key={claim.label}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}
            >
              {i > 0 && <span style={{ opacity: 0.35 }}>·</span>}
              <button
                type="button"
                onClick={() => onNavigate('activity')}
                title={claim.title}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = color.primary;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'inherit';
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: 0,
                  background: 'transparent',
                  border: 'none',
                  font: 'inherit',
                  letterSpacing: 'inherit',
                  color: 'inherit',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {i === 0 && (
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 9999,
                      background: color.emerald,
                    }}
                  />
                )}
                {claim.label}
              </button>
            </span>
          ))}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
          {children}
        </div>
      </main>
    </div>
  );
}
