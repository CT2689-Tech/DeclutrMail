'use client';
// revamp-lab · Console — Brief screen. SITREP framing: monospace digest,
// compact log rows, Noise collapsed to one stat line. Same data as the
// Stack Brief, dark operator register.

import { LAB_BRIEF } from './fixtures';

const C = {
  panel: '#14181C',
  line: 'rgba(255,255,255,0.07)',
  text: '#E8EAEC',
  dim: '#9AA3AB',
  faint: '#6B747C',
  teal: '#2DD4BF',
} as const;

const mono = 'var(--dm-font-mono), monospace';

export function ConsoleBrief({ mobile }: { mobile: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: mobile ? '16px 16px 40px' : '20px 32px 40px',
        maxWidth: 720,
      }}
    >
      <div style={{ fontFamily: mono, fontSize: 10.5, color: C.faint, letterSpacing: '0.08em' }}>
        SITREP — THU JUL 2
      </div>
      <div
        style={{
          marginTop: 10,
          background: C.panel,
          border: `1px solid ${C.line}`,
          borderRadius: 8,
          padding: 16,
          fontFamily: mono,
          fontSize: 12.5,
          lineHeight: 1.7,
          color: C.text,
        }}
      >
        {LAB_BRIEF.narrative}
      </div>

      <div
        style={{
          marginTop: 22,
          fontFamily: mono,
          fontSize: 10.5,
          color: C.teal,
          letterSpacing: '0.08em',
        }}
      >
        REPLY · {LAB_BRIEF.reply.length}
      </div>
      <div
        style={{ marginTop: 6, border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden' }}
      >
        {LAB_BRIEF.reply.map((item, i) => (
          <div
            key={item.subject}
            style={{
              display: 'flex',
              gap: 10,
              padding: '9px 12px',
              borderTop: i === 0 ? 'none' : `1px solid ${C.line}`,
              fontSize: 12.5,
            }}
          >
            <span style={{ color: C.teal, fontFamily: mono, fontWeight: 700, minWidth: 90 }}>
              {item.sender}
            </span>
            <span
              style={{
                color: C.dim,
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

      <div
        style={{
          marginTop: 22,
          fontFamily: mono,
          fontSize: 10.5,
          color: C.dim,
          letterSpacing: '0.08em',
        }}
      >
        FYI · {LAB_BRIEF.fyi.length}
      </div>
      <div
        style={{ marginTop: 6, border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden' }}
      >
        {LAB_BRIEF.fyi.map((item, i) => (
          <div
            key={item.subject}
            style={{
              display: 'flex',
              gap: 10,
              padding: '9px 12px',
              borderTop: i === 0 ? 'none' : `1px solid ${C.line}`,
              fontSize: 12.5,
            }}
          >
            <span style={{ color: C.faint, fontFamily: mono, minWidth: 90 }}>{item.sender}</span>
            <span
              style={{
                color: C.faint,
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

      <div
        style={{
          marginTop: 22,
          fontFamily: mono,
          fontSize: 11.5,
          color: C.faint,
          border: `1px dashed ${C.line}`,
          borderRadius: 8,
          padding: '10px 14px',
        }}
      >
        NOISE — {LAB_BRIEF.noiseCount} MSGS / {LAB_BRIEF.noiseSenderCount} SENDERS — AUTO-ARCHIVE
        ELIGIBLE
      </div>
    </div>
  );
}
