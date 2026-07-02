'use client';
// revamp-lab · Console — Billing screen. Framed as an "ACCOUNT TIER"
// system panel — same LAB_TIERS data as Stack, dark operator register,
// segmented monthly/annual control.

import { useState } from 'react';
import { LAB_FOUNDING_PRO, LAB_TIERS } from './fixtures';

const C = {
  panel: '#14181C',
  panel2: '#191E23',
  line: 'rgba(255,255,255,0.07)',
  text: '#E8EAEC',
  dim: '#9AA3AB',
  faint: '#6B747C',
  teal: '#2DD4BF',
  amber: '#FBBF24',
} as const;

const ui = 'var(--lab-intertight), system-ui, sans-serif';
const mono = 'var(--dm-font-mono), monospace';

export function ConsoleBilling({ mobile }: { mobile: boolean }) {
  const [annual, setAnnual] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: mobile ? '16px 16px 40px' : '20px 32px 40px',
        maxWidth: 900,
      }}
    >
      <div style={{ fontFamily: mono, fontSize: 10.5, color: C.faint, letterSpacing: '0.08em' }}>
        ACCOUNT — TIER
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
          marginTop: 6,
        }}
      >
        <h1 style={{ fontFamily: ui, fontSize: mobile ? 20 : 22, fontWeight: 700, margin: 0 }}>
          Pick your tier
        </h1>
        <div
          style={{
            display: 'flex',
            gap: 2,
            background: C.panel,
            border: `1px solid ${C.line}`,
            borderRadius: 6,
            padding: 2,
          }}
        >
          {(['MONTHLY', 'ANNUAL'] as const).map((label, i) => (
            <button
              key={label}
              onClick={() => setAnnual(i === 1)}
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                padding: '6px 12px',
                borderRadius: 5,
                border: 'none',
                cursor: 'pointer',
                background: annual === (i === 1) ? C.panel2 : 'transparent',
                color: annual === (i === 1) ? C.teal : C.dim,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          marginTop: 16,
          border: `1px solid ${C.amber}55`,
          background: 'rgba(251,191,36,0.06)',
          borderRadius: 8,
          padding: '12px 16px',
          display: 'flex',
          flexDirection: mobile ? 'column' : 'row',
          gap: 10,
          alignItems: mobile ? 'flex-start' : 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ fontFamily: mono, fontSize: 11.5, color: C.amber }}>
          FOUNDING PRO — ${LAB_FOUNDING_PRO.price}/YR · FIRST {LAB_FOUNDING_PRO.seatsLeft} · WAS $
          {LAB_FOUNDING_PRO.regular}/YR
        </div>
        <button
          onClick={() => {
            setFlash('LAB MOCK — claim ships with the real Billing screen.');
            setTimeout(() => setFlash(null), 2600);
          }}
          style={{
            fontFamily: mono,
            fontSize: 11,
            background: C.amber,
            color: '#0E1114',
            border: 'none',
            borderRadius: 6,
            padding: '7px 14px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          CLAIM
        </button>
      </div>
      {flash && (
        <div style={{ marginTop: 10, fontFamily: mono, fontSize: 11, color: C.teal }}>{flash}</div>
      )}

      <div
        style={{
          marginTop: 18,
          display: 'grid',
          gridTemplateColumns: mobile ? '1fr' : 'repeat(3, 1fr)',
          gap: 12,
        }}
      >
        {LAB_TIERS.map((t) => {
          const price = annual ? Math.round(t.priceAnnual / 12) : t.priceMonthly;
          return (
            <div
              key={t.id}
              style={{
                border: `1px solid ${t.popular ? C.teal : C.line}`,
                borderRadius: 10,
                padding: 16,
                background: C.panel,
                position: 'relative',
              }}
            >
              {t.popular && (
                <span
                  style={{
                    position: 'absolute',
                    top: -9,
                    left: 14,
                    background: C.teal,
                    color: '#0E1114',
                    fontFamily: mono,
                    fontSize: 9,
                    fontWeight: 700,
                    borderRadius: 4,
                    padding: '2px 8px',
                  }}
                >
                  RECOMMENDED
                </span>
              )}
              <div style={{ fontFamily: mono, fontSize: 12, color: C.text, fontWeight: 700 }}>
                {t.name.toUpperCase()}
              </div>
              <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2 }}>{t.tagline}</div>
              <div
                style={{
                  marginTop: 10,
                  fontFamily: mono,
                  fontSize: 26,
                  color: C.teal,
                  fontWeight: 700,
                }}
              >
                ${price}
                {price > 0 && <span style={{ fontSize: 12, color: C.faint }}>/mo</span>}
              </div>
              <button
                onClick={() => {
                  setFlash(`LAB MOCK — ${t.cta} ships with the real Billing screen.`);
                  setTimeout(() => setFlash(null), 2600);
                }}
                style={{
                  marginTop: 12,
                  width: '100%',
                  fontFamily: mono,
                  fontSize: 11,
                  background: t.popular ? C.teal : 'transparent',
                  color: t.popular ? '#0E1114' : C.text,
                  border: `1px solid ${t.popular ? C.teal : C.line}`,
                  borderRadius: 6,
                  padding: '8px 0',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t.cta.toUpperCase()}
              </button>
              <div style={{ marginTop: 12, display: 'grid', gap: 5 }}>
                {t.features.map((f) => (
                  <div key={f} style={{ fontSize: 11, color: C.dim, display: 'flex', gap: 6 }}>
                    <span style={{ color: C.teal }}>▸</span>
                    {f}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
