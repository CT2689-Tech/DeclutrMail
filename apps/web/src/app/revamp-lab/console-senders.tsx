'use client';
// revamp-lab · Console — Senders screen. Dense table, same cohort-filter
// language as Today's rail (now full-width chips since the rail is
// Today-only), row click opens the evidence-style detail inline.

import { useMemo, useState } from 'react';
import { verbById, type VerbId } from '@declutrmail/shared/actions';
import { activityBucket, LAB_ALL_SENDERS, type LabSender } from './fixtures';

const C = {
  panel: '#14181C',
  panel2: '#191E23',
  line: 'rgba(255,255,255,0.07)',
  text: '#E8EAEC',
  dim: '#9AA3AB',
  faint: '#6B747C',
  teal: '#2DD4BF',
  amber: '#FBBF24',
  red: '#F87171',
} as const;

const mono = 'var(--dm-font-mono), monospace';

type Bucket = 'all' | 'active' | 'quiet' | 'dormant' | 'protected';

function toneColor(verb: VerbId): string {
  const t = verbById(verb).tone;
  if (t === 'amber') return C.amber;
  if (t === 'danger') return C.red;
  if (t === 'dark') return C.dim;
  return C.teal;
}

export function ConsoleSenders({ mobile }: { mobile: boolean }) {
  const [bucket, setBucket] = useState<Bucket>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = {
      all: LAB_ALL_SENDERS.length,
      active: 0,
      quiet: 0,
      dormant: 0,
      protected: 0,
    };
    for (const s of LAB_ALL_SENDERS) {
      c[activityBucket(s)]++;
      if (s.protected) c.protected++;
    }
    return c;
  }, []);

  const filtered = useMemo(
    () =>
      LAB_ALL_SENDERS.filter((s) => {
        if (bucket === 'protected') return !!s.protected;
        if (bucket === 'all') return true;
        return activityBucket(s) === bucket;
      }),
    [bucket],
  );

  const open = LAB_ALL_SENDERS.find((s) => s.id === openId);

  const act = (s: LabSender, verb: VerbId) => {
    if (verb === 'unsubscribe' && s.unsubChannel === null) {
      setFlash(`NO UNSUB CHANNEL — ${s.domain} is transactional.`);
    } else {
      setFlash(
        `${verb.toUpperCase()} queued for ${s.domain} · lab mock, see Today for the real flow.`,
      );
    }
    setTimeout(() => setFlash(null), 2600);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: mobile ? '10px 14px' : '12px 20px',
          flexWrap: 'wrap',
          borderBottom: `1px solid ${C.line}`,
        }}
      >
        {(['all', 'active', 'quiet', 'dormant', 'protected'] as Bucket[]).map((b) => (
          <button
            key={b}
            onClick={() => setBucket(b)}
            style={{
              fontFamily: mono,
              fontSize: 10.5,
              padding: '6px 10px',
              borderRadius: 6,
              border: `1px solid ${bucket === b ? C.teal : C.line}`,
              background: bucket === b ? C.panel2 : 'transparent',
              color: bucket === b ? C.teal : C.dim,
              cursor: 'pointer',
            }}
          >
            {b.toUpperCase()} {counts[b]}
          </button>
        ))}
      </div>

      {flash && (
        <div style={{ margin: '10px 20px 0', fontFamily: mono, fontSize: 11, color: C.teal }}>
          {flash}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.map((s) => {
          const isOpen = openId === s.id;
          return (
            <div key={s.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setOpenId(isOpen ? null : s.id)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: mobile
                    ? '1fr auto'
                    : 'minmax(0,1.6fr) 90px 90px minmax(0,1fr)',
                  alignItems: 'center',
                  padding: mobile ? '12px 14px' : '10px 20px',
                  background: isOpen ? C.panel2 : 'transparent',
                  borderLeft: `2px solid ${isOpen ? C.teal : 'transparent'}`,
                  borderBottom: `1px solid ${C.line}`,
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{s.name}</span>
                  {s.protected && (
                    <span style={{ fontFamily: mono, fontSize: 9, color: C.teal, marginLeft: 8 }}>
                      ◆ PROTECTED
                    </span>
                  )}
                  <span
                    style={{ display: 'block', fontFamily: mono, fontSize: 10.5, color: C.faint }}
                  >
                    {s.email}
                  </span>
                </span>
                {!mobile && (
                  <span style={{ fontFamily: mono, fontSize: 12, color: C.dim }}>{s.perMonth}</span>
                )}
                {!mobile && (
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 12,
                      color: s.readRate < 0.05 ? C.red : C.dim,
                    }}
                  >
                    {Math.round(s.readRate * 100)}%
                  </span>
                )}
                <span
                  style={{
                    fontFamily: mono,
                    fontSize: 10.5,
                    color: toneColor(s.recommended),
                    textAlign: mobile ? 'right' : 'left',
                  }}
                >
                  {verbById(s.recommended).label.toUpperCase()} · {s.confidence}%
                </span>
              </div>
              {isOpen && open && (
                <div
                  style={{
                    padding: mobile ? '10px 14px 14px' : '10px 20px 16px',
                    borderBottom: `1px solid ${C.line}`,
                    background: C.panel,
                  }}
                >
                  <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.5 }}>
                    {open.reasoning}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    {(['keep', 'archive', 'unsubscribe'] as VerbId[]).map((v) => {
                      const disabled = v === 'unsubscribe' && open.unsubChannel === null;
                      return (
                        <button
                          key={v}
                          disabled={disabled}
                          onClick={() => act(open, v)}
                          style={{
                            fontFamily: mono,
                            fontSize: 11,
                            padding: '6px 12px',
                            borderRadius: 6,
                            border: `1px solid ${disabled ? C.line : toneColor(v)}`,
                            color: disabled ? C.faint : toneColor(v),
                            background: 'transparent',
                            cursor: disabled ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {verbById(v).label.toUpperCase()}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
