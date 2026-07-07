'use client';

import { useEffect, useRef, useState } from 'react';
import { tokens } from '@declutrmail/shared';
import type { Facet } from './data';

const { color, font } = tokens;

/** Signal-facet filter dropdown — refines within the current category. */
export function FiltersMenu({
  facets,
  counts,
  active,
  onToggle,
  onClear,
}: {
  facets: Facet[];
  counts: Record<string, number>;
  active: Set<string>;
  onToggle: (key: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 11px',
          background: active.size > 0 ? color.primarySoft : color.card,
          color: active.size > 0 ? color.primary : color.fgSoft,
          border: `1px solid ${active.size > 0 ? color.primaryBorder : color.border}`,
          borderRadius: 6,
          fontFamily: font.sans,
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
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
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        Filters
        {active.size > 0 && (
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 10,
              fontWeight: 700,
              background: color.primary,
              color: color.fgInverse,
              padding: '0 5px',
              borderRadius: 9999,
            }}
          >
            {active.size}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 50,
            minWidth: 240,
            background: color.card,
            border: `1px solid ${color.border}`,
            borderRadius: 10,
            boxShadow: tokens.shadow.pop,
            padding: 6,
          }}
        >
          {facets.map((f) => {
            const on = active.has(f.key);
            const count = counts[f.key] ?? 0;
            return (
              <button
                key={f.key}
                onClick={() => onToggle(f.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  width: '100%',
                  padding: '7px 9px',
                  background: on ? color.primarySoft : 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: font.sans,
                }}
              >
                <span
                  style={{
                    width: 15,
                    height: 15,
                    borderRadius: 4,
                    border: `1.5px solid ${on ? color.primary : 'rgba(14,20,19,0.28)'}`,
                    background: on ? color.primary : color.card,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {on && (
                    <svg
                      width="9"
                      height="9"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#FFFFFF"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                <span style={{ flex: 1, fontSize: 12.5, color: color.fg, fontWeight: 500 }}>
                  {f.label}
                </span>
                <span
                  style={{
                    fontFamily: font.mono,
                    fontSize: 10.5,
                    color: color.fgMuted,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
          {active.size > 0 && (
            <button
              onClick={() => {
                onClear();
                setOpen(false);
              }}
              style={{
                width: '100%',
                marginTop: 4,
                padding: '7px 9px',
                background: 'transparent',
                border: `1px solid ${color.line}`,
                borderRadius: 6,
                cursor: 'pointer',
                fontFamily: font.sans,
                fontSize: 12,
                fontWeight: 600,
                color: color.fgSoft,
              }}
            >
              Clear all filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
