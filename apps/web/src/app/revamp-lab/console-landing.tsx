'use client';
// revamp-lab · Console — Landing screen. Pre-auth, no app chrome. Dark
// terminal-boot register — the visual system starts before login, not
// just after.

import { PRIVACY_BADGE_HEADLINE, PRIVACY_STORAGE_ITEMS } from '@declutrmail/shared';

const C = {
  bg: '#0E1114',
  panel: '#14181C',
  line: 'rgba(255,255,255,0.07)',
  text: '#E8EAEC',
  dim: '#9AA3AB',
  faint: '#6B747C',
  teal: '#2DD4BF',
  green: '#4ADE80',
} as const;

const ui = 'var(--lab-intertight), system-ui, sans-serif';
const mono = 'var(--dm-font-mono), monospace';

export function ConsoleLanding({ mobile }: { mobile: boolean }) {
  return (
    <div
      style={{
        minHeight: mobile ? undefined : '100dvh',
        height: mobile ? '100%' : undefined,
        overflowY: mobile ? 'auto' : undefined,
        background: C.bg,
        color: C.text,
        fontFamily: ui,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: mobile ? '12px 14px' : '12px 20px',
          borderBottom: `1px solid ${C.line}`,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '0.02em' }}>
          DECLUTR<span style={{ color: C.teal }}>MAIL</span>
        </div>
        <a
          href="#console.today"
          style={{
            background: C.teal,
            color: '#0E1114',
            borderRadius: 6,
            padding: '7px 14px',
            fontSize: 12.5,
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          Open console →
        </a>
      </header>

      <main
        style={{
          padding: mobile ? '28px 20px 40px' : '64px 32px',
          maxWidth: 900,
          margin: '0 auto',
        }}
      >
        <div style={{ fontFamily: mono, fontSize: 11, color: C.faint, letterSpacing: '0.08em' }}>
          $ declutrmail --init
        </div>
        <h1
          style={{
            fontFamily: mono,
            fontSize: mobile ? 26 : 38,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            lineHeight: 1.3,
            margin: '14px 0 16px',
          }}
        >
          <span style={{ color: C.teal }}>&gt;</span> Your inbox, as a system you operate.
        </h1>
        <p style={{ color: C.dim, fontSize: 15, lineHeight: 1.6, maxWidth: 520, fontFamily: ui }}>
          Cohorts, evidence, batch ops, one status bar. Every sender is a row; every row has a
          reason. Nothing commits without a preview.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
          <a
            href="#console.today"
            style={{
              background: C.teal,
              color: '#0E1114',
              borderRadius: 8,
              padding: '11px 20px',
              fontWeight: 700,
              fontSize: 13.5,
              textDecoration: 'none',
              fontFamily: ui,
            }}
          >
            Connect Gmail →
          </a>
          <a
            href="#console.billing"
            style={{
              border: `1px solid ${C.line}`,
              color: C.text,
              borderRadius: 8,
              padding: '11px 20px',
              fontWeight: 700,
              fontSize: 13.5,
              textDecoration: 'none',
              fontFamily: ui,
            }}
          >
            View pricing
          </a>
        </div>

        <div
          style={{
            marginTop: 40,
            background: C.panel,
            border: `1px solid ${C.line}`,
            borderRadius: 10,
            padding: mobile ? 16 : 20,
            fontFamily: mono,
            fontSize: 12,
            lineHeight: 1.9,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.green }}>
            <span
              aria-hidden
              style={{ width: 6, height: 6, borderRadius: 999, background: C.green }}
            />
            {PRIVACY_BADGE_HEADLINE.toUpperCase()}
          </div>
          <div style={{ color: C.faint, marginTop: 6 }}>── STORAGE ALLOWLIST ──────────────</div>
          {PRIVACY_STORAGE_ITEMS.map((item) => (
            <div key={item}>
              <span style={{ color: C.teal }}>+</span> {item}
            </div>
          ))}
          <div style={{ color: C.faint }}>─────────────────────────────────</div>
        </div>
      </main>
    </div>
  );
}
