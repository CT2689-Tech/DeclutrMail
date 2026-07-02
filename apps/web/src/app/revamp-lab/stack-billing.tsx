'use client';
// revamp-lab · Stack — Billing screen. Warm pricing cards, real numbers
// from the live pricing screen (verified 2026-07-02 walk). Monthly/annual
// toggle is wired; CTAs are lab mocks.

import { useState } from 'react';
import { LAB_FOUNDING_PRO, LAB_TIERS } from './fixtures';

const C = {
  card: '#FFFFFF',
  ink: '#16130E',
  soft: '#6F6A5E',
  line: '#E5E1D8',
  indigo: '#4F46E5',
  indigoDeep: '#3730A3',
  teal: '#0F766E',
} as const;

const mono = 'var(--dm-font-mono), monospace';

export function StackBilling({ mobile }: { mobile: boolean }) {
  const [annual, setAnnual] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  return (
    <div
      style={{
        padding: mobile ? '16px 16px 40px' : '24px 32px 48px',
        maxWidth: 900,
        margin: '0 auto',
      }}
    >
      <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.1em', color: C.soft }}>
        PRICING
      </div>
      <h1
        style={{
          fontSize: mobile ? 26 : 32,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          margin: '8px 0 10px',
        }}
      >
        Pick how clean you want to stay.
      </h1>
      <p style={{ color: C.soft, fontSize: 14.5, maxWidth: 520, lineHeight: 1.5 }}>
        Every plan acts only with the five verbs you approve — Keep, Archive, Unsubscribe, Later,
        Delete — and every action is undoable.
      </p>

      <div
        style={{
          marginTop: 20,
          background: C.indigoDeep,
          color: '#fff',
          borderRadius: 16,
          padding: mobile ? 16 : 20,
          display: 'flex',
          flexDirection: mobile ? 'column' : 'row',
          gap: 12,
          alignItems: mobile ? 'flex-start' : 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>
            Founding Pro — ${LAB_FOUNDING_PRO.price}/yr for the first {LAB_FOUNDING_PRO.seatsLeft}{' '}
            members
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 2 }}>
            Instead of ${LAB_FOUNDING_PRO.regular}/yr — price locked while your subscription stays
            active.
          </div>
        </div>
        <button
          onClick={() => {
            setFlash('Lab mock — Founding Pro claim ships with the real Billing screen.');
            setTimeout(() => setFlash(null), 2800);
          }}
          style={{
            background: '#8BD8CB',
            color: C.indigoDeep,
            border: 'none',
            borderRadius: 10,
            padding: '10px 18px',
            fontWeight: 800,
            fontSize: 13,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Claim Founding Pro
        </button>
      </div>

      {flash && <div style={{ marginTop: 12, fontSize: 12.5, color: C.teal }}>{flash}</div>}

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 26 }}>
        <div
          style={{
            background: '#EAE7DE',
            borderRadius: 999,
            padding: 3,
            display: 'flex',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {(['Monthly', 'Annual'] as const).map((label, i) => (
            <button
              key={label}
              onClick={() => setAnnual(i === 1)}
              style={{
                padding: '7px 16px',
                borderRadius: 999,
                border: 'none',
                cursor: 'pointer',
                background: annual === (i === 1) ? C.ink : 'transparent',
                color: annual === (i === 1) ? '#fff' : C.soft,
              }}
            >
              {label} {i === 1 && <span style={{ opacity: 0.7 }}>— 2 months free</span>}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          marginTop: 22,
          display: 'grid',
          gridTemplateColumns: mobile ? '1fr' : 'repeat(3, 1fr)',
          gap: 14,
        }}
      >
        {LAB_TIERS.map((t) => {
          const price = annual ? Math.round(t.priceAnnual / 12) : t.priceMonthly;
          return (
            <div
              key={t.id}
              style={{
                position: 'relative',
                background: C.card,
                border: `1px solid ${t.popular ? C.indigo : C.line}`,
                borderRadius: 18,
                padding: 22,
              }}
            >
              {t.popular && (
                <span
                  style={{
                    position: 'absolute',
                    top: -11,
                    left: 20,
                    background: C.indigo,
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: '0.05em',
                    borderRadius: 999,
                    padding: '4px 10px',
                  }}
                >
                  MOST POPULAR
                </span>
              )}
              <div style={{ fontWeight: 800, fontSize: 18 }}>{t.name}</div>
              <div style={{ fontSize: 13, color: C.soft, marginTop: 2 }}>{t.tagline}</div>
              <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em' }}>
                  ${price}
                </span>
                {price > 0 && <span style={{ color: C.soft, fontSize: 13 }}>/mo</span>}
              </div>
              <div style={{ fontSize: 11.5, color: C.soft, marginTop: 2 }}>No card required</div>
              <button
                onClick={() => {
                  setFlash(`Lab mock — ${t.cta} ships with the real Billing screen.`);
                  setTimeout(() => setFlash(null), 2800);
                }}
                style={{
                  marginTop: 16,
                  width: '100%',
                  background: t.popular ? C.indigo : 'transparent',
                  color: t.popular ? '#fff' : C.ink,
                  border: `1px solid ${t.popular ? C.indigo : C.line}`,
                  borderRadius: 10,
                  padding: '10px 0',
                  fontWeight: 700,
                  fontSize: 13.5,
                  cursor: 'pointer',
                }}
              >
                {t.cta}
              </button>
              <div style={{ marginTop: 16, display: 'grid', gap: 7 }}>
                {t.features.map((f) => (
                  <div key={f} style={{ display: 'flex', gap: 8, fontSize: 12.5 }}>
                    <span style={{ color: C.teal }}>✓</span>
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
