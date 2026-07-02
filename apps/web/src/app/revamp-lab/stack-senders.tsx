'use client';
// revamp-lab · Stack — Senders screen. Warm card grid, filter chips +
// search actually filter LAB_ALL_SENDERS client-side. Verb chips open
// a tiny inline confirm (not the full Today preview machinery — Today
// already proves that model deeply; this screen proves the visual system).

import { useMemo, useState } from 'react';
import { verbById, type VerbId } from '@declutrmail/shared/actions';
import { activityBucket, LAB_ALL_SENDERS, type LabSender } from './fixtures';

const C = {
  card: '#FFFFFF',
  ink: '#16130E',
  soft: '#6F6A5E',
  line: '#E5E1D8',
  indigo: '#4F46E5',
  indigoSoft: '#EEF0FF',
  teal: '#0F766E',
  amber: '#B45309',
} as const;

const mono = 'var(--dm-font-mono), monospace';

type Bucket = 'all' | 'active' | 'quiet' | 'dormant' | 'protected';

function toneColor(verb: VerbId): string {
  const t = verbById(verb).tone;
  if (t === 'amber') return C.amber;
  if (t === 'danger') return '#B91C1C';
  if (t === 'dark') return C.ink;
  return C.teal;
}

export function StackSenders({ mobile }: { mobile: boolean }) {
  const [bucket, setBucket] = useState<Bucket>('all');
  const [q, setQ] = useState('');
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

  const filtered = useMemo(() => {
    return LAB_ALL_SENDERS.filter((s) => {
      if (bucket === 'protected' && !s.protected) return false;
      if (bucket !== 'all' && bucket !== 'protected' && activityBucket(s) !== bucket) return false;
      if (
        q &&
        !s.name.toLowerCase().includes(q.toLowerCase()) &&
        !s.domain.includes(q.toLowerCase())
      )
        return false;
      return true;
    });
  }, [bucket, q]);

  const act = (s: LabSender, verb: VerbId) => {
    if (verb === 'unsubscribe' && s.unsubChannel === null) {
      setFlash(`${s.name} has no unsubscribe channel — try Archive instead.`);
    } else {
      setFlash(
        `${verbById(verb).label} queued for ${s.name} · lab mock, see Today for the real flow.`,
      );
    }
    setTimeout(() => setFlash(null), 2800);
  };

  const chips: Array<{ id: Bucket; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active' },
    { id: 'quiet', label: 'Quiet' },
    { id: 'dormant', label: 'Dormant' },
    { id: 'protected', label: 'Protected' },
  ];

  return (
    <div
      style={{
        padding: mobile ? '16px 16px 40px' : '24px 32px 48px',
        maxWidth: 1080,
        margin: '0 auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <h1
          style={{
            fontSize: mobile ? 24 : 28,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            margin: 0,
          }}
        >
          {LAB_ALL_SENDERS.length} senders
        </h1>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search senders…"
          style={{
            border: `1px solid ${C.line}`,
            borderRadius: 10,
            padding: '9px 14px',
            fontSize: 13.5,
            fontFamily: 'inherit',
            width: mobile ? '100%' : 220,
            background: C.card,
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        {chips.map((c) => (
          <button
            key={c.id}
            onClick={() => setBucket(c.id)}
            style={{
              background: bucket === c.id ? C.ink : C.card,
              color: bucket === c.id ? '#fff' : C.soft,
              border: `1px solid ${bucket === c.id ? C.ink : C.line}`,
              borderRadius: 999,
              padding: '7px 14px',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {c.label} <span style={{ opacity: 0.7 }}>{counts[c.id]}</span>
          </button>
        ))}
      </div>

      {flash && (
        <div
          style={{
            marginTop: 14,
            fontSize: 13,
            color: C.teal,
            background: C.indigoSoft,
            border: `1px solid ${C.indigo}33`,
            borderRadius: 10,
            padding: '9px 14px',
          }}
        >
          {flash}
        </div>
      )}

      <div
        style={{
          marginTop: 18,
          display: 'grid',
          gridTemplateColumns: mobile ? '1fr' : 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 12,
        }}
      >
        {filtered.map((s) => (
          <div
            key={s.id}
            style={{
              background: C.card,
              border: `1px solid ${C.line}`,
              borderRadius: 16,
              padding: 16,
            }}
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div
                aria-hidden
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: C.indigoSoft,
                  color: C.indigo,
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 800,
                  fontSize: 15,
                }}
              >
                {s.name[0]}
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 14,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.name}
                </div>
                <div style={{ fontFamily: mono, fontSize: 10.5, color: C.soft }}>{s.domain}</div>
              </div>
              {s.protected && (
                <span style={{ marginLeft: 'auto', fontFamily: mono, fontSize: 9, color: C.teal }}>
                  PROTECTED
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 14, marginTop: 12, fontSize: 12 }}>
              <span>
                <b>{s.perMonth}</b> <span style={{ color: C.soft }}>/mo</span>
              </span>
              <span>
                <b>{Math.round(s.readRate * 100)}%</b> <span style={{ color: C.soft }}>read</span>
              </span>
              <span>
                <b>{s.lifetime.toLocaleString('en-US')}</b>{' '}
                <span style={{ color: C.soft }}>total</span>
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
              {(['keep', 'archive', 'unsubscribe'] as VerbId[]).map((v) => {
                const disabled = v === 'unsubscribe' && s.unsubChannel === null;
                return (
                  <button
                    key={v}
                    disabled={disabled}
                    onClick={() => act(s, v)}
                    style={{
                      background: 'transparent',
                      border: `1px solid ${disabled ? C.line : toneColor(v)}55`,
                      color: disabled ? '#B5B0A4' : toneColor(v),
                      borderRadius: 8,
                      padding: '5px 10px',
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {verbById(v).label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div
            style={{
              gridColumn: '1/-1',
              textAlign: 'center',
              color: C.soft,
              padding: '40px 0',
              fontSize: 14,
            }}
          >
            No senders match “{q}”.
          </div>
        )}
      </div>
    </div>
  );
}
