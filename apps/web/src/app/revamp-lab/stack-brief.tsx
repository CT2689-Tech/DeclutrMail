'use client';
// revamp-lab · Stack — Brief screen. Warm narrative card + Reply/FYI rows,
// Noise collapsed to one line. Mirrors the real Brief's structure (live
// walk 2026-07-02) in the Stack visual system.

import { LAB_BRIEF } from './fixtures';

const C = {
  card: '#FFFFFF',
  ink: '#16130E',
  soft: '#6F6A5E',
  line: '#E5E1D8',
  indigo: '#4F46E5',
  indigoSoft: '#EEF0FF',
} as const;

const mono = 'var(--dm-font-mono), monospace';

export function StackBrief({ mobile }: { mobile: boolean }) {
  return (
    <div
      style={{
        padding: mobile ? '16px 16px 40px' : '24px 32px 48px',
        maxWidth: 680,
        margin: '0 auto',
      }}
    >
      <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.1em', color: C.soft }}>
        THURSDAY, JULY 2
      </div>
      <h1
        style={{
          fontSize: mobile ? 26 : 30,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          margin: '8px 0 18px',
        }}
      >
        Your Brief
      </h1>

      <div
        style={{
          background: C.indigoSoft,
          border: `1px solid ${C.indigo}33`,
          borderRadius: 16,
          padding: 18,
          fontSize: 14.5,
          lineHeight: 1.6,
        }}
      >
        {LAB_BRIEF.narrative}
      </div>

      <div style={{ marginTop: 28 }}>
        <div style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: '0.1em', color: C.soft }}>
          REPLY · {LAB_BRIEF.reply.length} OF {LAB_BRIEF.reply.length}
        </div>
        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          {LAB_BRIEF.reply.map((item) => (
            <div
              key={item.subject}
              style={{
                background: C.card,
                border: `1px solid ${C.line}`,
                borderRadius: 12,
                padding: '12px 14px',
                display: 'flex',
                gap: 12,
                alignItems: 'center',
              }}
            >
              <div
                aria-hidden
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9,
                  background: C.indigoSoft,
                  color: C.indigo,
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 800,
                  fontSize: 13,
                  flexShrink: 0,
                }}
              >
                {item.sender[0]}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{item.sender}</div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: C.soft,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.subject}
                </div>
              </div>
              <span
                style={{ marginLeft: 'auto', fontSize: 12, color: C.indigo, whiteSpace: 'nowrap' }}
              >
                Open in Gmail →
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: '0.1em', color: C.soft }}>
          FYI · {LAB_BRIEF.fyi.length} OF {LAB_BRIEF.fyi.length}
        </div>
        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          {LAB_BRIEF.fyi.map((item) => (
            <div
              key={item.subject}
              style={{
                border: `1px solid ${C.line}`,
                borderRadius: 12,
                padding: '10px 14px',
                fontSize: 13,
                display: 'flex',
                justifyContent: 'space-between',
                gap: 10,
              }}
            >
              <span style={{ fontWeight: 600 }}>{item.sender}</span>
              <span
                style={{
                  color: C.soft,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.subject}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          marginTop: 24,
          border: `1px dashed ${C.line}`,
          borderRadius: 12,
          padding: '12px 14px',
          fontSize: 13,
          color: C.soft,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>Noise</span>
        <span>
          {LAB_BRIEF.noiseCount} messages · {LAB_BRIEF.noiseSenderCount} senders — safe to bulk
          archive
        </span>
      </div>
    </div>
  );
}
