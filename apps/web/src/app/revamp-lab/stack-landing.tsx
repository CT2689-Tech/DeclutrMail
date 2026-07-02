'use client';
// revamp-lab · Stack — Landing screen. Pre-auth, no app chrome (matches
// the real product's pre/post-auth split). Warm card-table register,
// indigo accent, same card/keycap motifs as Today so the identity
// carries from first impression into the core loop.

import { PRIVACY_BADGE_HEADLINE, PRIVACY_STORAGE_ITEMS } from '@declutrmail/shared';
import { VERB_REGISTRY } from '@declutrmail/shared/actions';

const C = {
  bg: '#F4F2ED',
  card: '#FFFFFF',
  ink: '#16130E',
  soft: '#6F6A5E',
  line: '#E5E1D8',
  indigo: '#4F46E5',
  indigoSoft: '#EEF0FF',
  teal: '#0F766E',
} as const;

const grotesk = 'var(--lab-grotesk), system-ui, sans-serif';
const mono = 'var(--dm-font-mono), monospace';

export function StackLanding({ mobile }: { mobile: boolean }) {
  return (
    <div
      style={{
        minHeight: mobile ? undefined : '100dvh',
        height: mobile ? '100%' : undefined,
        overflowY: mobile ? 'auto' : undefined,
        background: C.bg,
        color: C.ink,
        fontFamily: grotesk,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: mobile ? '14px 16px' : '18px 32px',
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: '-0.02em' }}>
          Declutr<span style={{ color: C.indigo }}>Mail</span>
        </div>
        {!mobile && (
          <nav style={{ display: 'flex', gap: 22, fontSize: 13.5, color: C.soft }}>
            <span>How it works</span>
            <span>Privacy</span>
            <span>Pricing</span>
          </nav>
        )}
        <a
          href="#stack.today"
          style={{
            background: C.ink,
            color: '#fff',
            borderRadius: 999,
            padding: '9px 18px',
            fontSize: 13,
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          Open app →
        </a>
      </header>

      <main
        style={{
          padding: mobile ? '20px 20px 40px' : '48px 32px 64px',
          maxWidth: 1080,
          margin: '0 auto',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: mobile ? '1fr' : '1.1fr 0.9fr',
            gap: mobile ? 28 : 48,
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.1em', color: C.soft }}>
              GMAIL CLEANUP · SESSION-FIRST
            </div>
            <h1
              style={{
                fontSize: mobile ? 38 : 54,
                fontWeight: 800,
                letterSpacing: '-0.03em',
                lineHeight: 1.04,
                margin: '12px 0 16px',
              }}
            >
              One sweep. <span style={{ color: C.indigo }}>Then you&apos;re done.</span>
            </h1>
            <p style={{ fontSize: 16.5, color: C.soft, lineHeight: 1.55, maxWidth: 460 }}>
              DeclutrMail turns thousands of emails into a short morning sweep — one sender at a
              time, five keys, always reversible. Finish it, and the app tells you to leave.
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 26, flexWrap: 'wrap' }}>
              <a
                href="#stack.today"
                style={{
                  background: C.indigo,
                  color: '#fff',
                  borderRadius: 12,
                  padding: '13px 24px',
                  fontWeight: 700,
                  fontSize: 14.5,
                  textDecoration: 'none',
                }}
              >
                Connect your Gmail →
              </a>
              <a
                href="#stack.billing"
                style={{
                  border: `1px solid ${C.line}`,
                  color: C.ink,
                  borderRadius: 12,
                  padding: '13px 24px',
                  fontWeight: 700,
                  fontSize: 14.5,
                  textDecoration: 'none',
                }}
              >
                See pricing
              </a>
            </div>
            <div style={{ marginTop: 14, fontSize: 12.5, color: C.soft }}>
              Free tier · no card · every action reversible
            </div>
          </div>

          {/* Trust card — the pre-OAuth moment, given real weight (per audit §8) */}
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.line}`,
              borderRadius: 20,
              padding: mobile ? 20 : 26,
              boxShadow: '0 24px 48px -24px rgba(22,19,14,0.18)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                aria-hidden
                style={{ width: 8, height: 8, borderRadius: 999, background: C.teal }}
              />
              <span
                style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.08em', color: C.teal }}
              >
                {PRIVACY_BADGE_HEADLINE.toUpperCase()}
              </span>
            </div>
            <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
              {PRIVACY_STORAGE_ITEMS.map((item) => (
                <div key={item} style={{ display: 'flex', gap: 8, fontSize: 13.5, color: C.ink }}>
                  <span style={{ color: C.teal }}>✓</span>
                  {item}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <div
                  aria-hidden
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    background: C.indigoSoft,
                    color: C.indigo,
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 800,
                  }}
                >
                  A
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Amazon.com</div>
                  <div style={{ fontFamily: mono, fontSize: 11, color: C.soft }}>
                    ENGINE — UNSUBSCRIBE · 95%
                  </div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  {VERB_REGISTRY.slice(0, 3).map((v) => (
                    <span
                      key={v.id}
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 8,
                        border: `1px solid ${C.line}`,
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 11,
                        fontWeight: 700,
                        color: C.soft,
                      }}
                    >
                      {v.shortcut}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* How it works strip */}
        <div
          style={{
            marginTop: mobile ? 44 : 72,
            display: 'grid',
            gridTemplateColumns: mobile ? '1fr' : 'repeat(3, 1fr)',
            gap: 16,
          }}
        >
          {[
            ['01', 'Connect', 'Read-only Gmail access. We index headers, never bodies.'],
            ['02', 'Sweep', 'One sender at a time — Keep, Archive, Unsubscribe, Later, Delete.'],
            ['03', 'Done', 'A receipt, an undo window, and a reason to close the tab.'],
          ].map(([n, t, d]) => (
            <div key={n} style={{ border: `1px solid ${C.line}`, borderRadius: 16, padding: 20 }}>
              <div style={{ fontFamily: mono, fontSize: 11, color: C.indigo }}>{n}</div>
              <div style={{ fontWeight: 800, fontSize: 17, marginTop: 6 }}>{t}</div>
              <div style={{ fontSize: 13.5, color: C.soft, marginTop: 6, lineHeight: 1.5 }}>
                {d}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
