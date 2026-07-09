'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import { tokens } from '@declutrmail/shared';

import { oauthStartUrl } from '@/features/marketing/landing/urls';
import { track } from '@/lib/posthog';

import {
  DEMO_SENDERS,
  DEMO_STORAGE_KEY,
  type DemoSender,
  type DemoVerdict,
  verbLabel,
} from './mock-inbox';

const { color } = tokens;

const VERBS: DemoVerdict[] = ['keep', 'archive', 'unsubscribe', 'later', 'delete'];

interface Decision {
  senderId: string;
  verb: DemoVerdict;
  at: number;
}

/**
 * No-signup inbox simulator (D133 pragmatic slice).
 *
 * Local-only decisions — no API, no bodies. Uses precomputed demo
 * verdicts and the same K/A/U/L/D verb set as the product.
 */
export function InboxSimulatorScreen() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [focused, setFocused] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DEMO_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Decision[];
        if (Array.isArray(parsed)) setDecisions(parsed);
      }
    } catch {
      // ignore corrupt demo state
    }
    setHydrated(true);
    void track('page_viewed', { page: 'inbox_simulator', mailbox_id: null });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(decisions));
    } catch {
      // quota / private mode
    }
  }, [decisions, hydrated]);

  const decidedIds = useMemo(() => new Set(decisions.map((d) => d.senderId)), [decisions]);
  const remaining = DEMO_SENDERS.filter((s) => !decidedIds.has(s.id));
  const focusIndex = Math.min(focused, Math.max(0, remaining.length - 1));
  const focusSender = remaining[focusIndex] ?? null;

  const projectedSkip = decisions.reduce((sum, d) => {
    const s = DEMO_SENDERS.find((x) => x.id === d.senderId);
    if (!s) return sum;
    if (d.verb === 'keep' || d.verb === 'later') return sum;
    return sum + s.monthlyVolume * 12;
  }, 0);

  function decide(sender: DemoSender, verb: DemoVerdict) {
    const first = decisions.length === 0;
    setDecisions((prev) => [...prev, { senderId: sender.id, verb, at: Date.now() }]);
    if (first) {
      void track('landing_cta_clicked', { cta: 'try_demo', placement: 'hero' });
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!focusSender) return;
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        setFocused((i) => Math.min(i + 1, remaining.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocused((i) => Math.max(i - 1, 0));
        return;
      }
      const map: Record<string, DemoVerdict> = {
        k: 'keep',
        a: 'archive',
        u: 'unsubscribe',
        l: 'later',
        d: 'delete',
      };
      const verb = map[e.key.toLowerCase()];
      if (verb) {
        e.preventDefault();
        decide(focusSender, verb);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '48px 20px 80px' }}>
      <p
        style={{
          fontSize: 12,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: color.fgMuted,
        }}
      >
        Demo · no signup · nothing leaves this browser
      </p>
      <h1 style={{ fontSize: 36, lineHeight: 1.15, margin: '8px 0 12px' }}>
        Try the sender ritual before you connect Gmail.
      </h1>
      <p style={{ color: color.fgMuted, lineHeight: 1.55, maxWidth: 560 }}>
        Sixteen mock senders. Same verbs as the product — Keep, Archive, Unsubscribe, Later, Delete
        (shortcuts K/A/U/L/D). Decisions stay in localStorage. Full bodies fetched: 0 — this demo
        never had bodies to begin with.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 240px',
          gap: 24,
          marginTop: 32,
        }}
        className="dm-demo-grid"
      >
        <div>
          {remaining.length === 0 ? (
            <p style={{ padding: 24, background: '#fafaf7', borderRadius: 8 }}>
              Queue clear. Connect Gmail to run this on your real senders — every action still
              previews first.
            </p>
          ) : (
            remaining.map((sender, i) => (
              <DemoRow
                key={sender.id}
                sender={sender}
                focused={i === focusIndex}
                onFocus={() => setFocused(i)}
                onDecide={(verb) => decide(sender, verb)}
              />
            ))
          )}
        </div>

        <aside style={{ position: 'sticky', top: 24, alignSelf: 'start' }}>
          <div style={{ padding: 16, background: '#fafaf7', borderRadius: 8, marginBottom: 16 }}>
            <p style={{ fontSize: 12, color: color.fgMuted, margin: 0 }}>Decisions</p>
            <p style={{ fontSize: 28, fontWeight: 600, margin: '4px 0' }}>{decisions.length}</p>
            {decisions.length >= 5 ? (
              <p style={{ fontSize: 13, lineHeight: 1.45, margin: 0 }}>
                Estimated impact if these were real:{' '}
                <strong>~{projectedSkip.toLocaleString()} future emails / year</strong> skip your
                inbox from the senders you archived, unsubscribed, or deleted.
              </p>
            ) : (
              <p style={{ fontSize: 13, color: color.fgMuted, margin: 0 }}>
                Make {5 - decisions.length} more decision{5 - decisions.length === 1 ? '' : 's'} to
                see projected impact.
              </p>
            )}
          </div>
          <ol style={{ paddingLeft: 18, fontSize: 13, lineHeight: 1.45, color: color.fgMuted }}>
            {decisions
              .slice()
              .reverse()
              .slice(0, 8)
              .map((d) => {
                const s = DEMO_SENDERS.find((x) => x.id === d.senderId);
                return (
                  <li key={`${d.senderId}-${d.at}`}>
                    {s?.name ?? d.senderId} · {verbLabel(d.verb)}
                  </li>
                );
              })}
          </ol>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 20 }}>
            <a
              href={oauthStartUrl()}
              onClick={() =>
                void track('landing_cta_clicked', { cta: 'connect_gmail', placement: 'final' })
              }
              style={primaryBtn}
            >
              See this on your real inbox →
            </a>
            <a href="/methodology" style={ghostBtn}>
              How we calculate this →
            </a>
            <button
              type="button"
              onClick={() => {
                setDecisions([]);
                setFocused(0);
                try {
                  localStorage.removeItem(DEMO_STORAGE_KEY);
                } catch {
                  /* ignore */
                }
              }}
              style={{ ...ghostBtn, cursor: 'pointer', border: 'none', background: 'transparent' }}
            >
              Reset demo
            </button>
          </div>
        </aside>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .dm-demo-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function DemoRow({
  sender,
  focused,
  onFocus,
  onDecide,
}: {
  sender: DemoSender;
  focused: boolean;
  onFocus: () => void;
  onDecide: (verb: DemoVerdict) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onFocus}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onFocus();
      }}
      style={{
        padding: '14px 12px',
        borderBottom: '1px solid #eee',
        background: focused ? '#f4f4f0' : 'transparent',
        outline: focused ? `2px solid ${color.fg}` : 'none',
        outlineOffset: -2,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 600 }}>{sender.name}</div>
          <div style={{ fontSize: 12, color: color.fgMuted }}>
            {sender.domain} · {sender.monthlyVolume}/mo · {Math.round(sender.readRate * 100)}% read
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            Suggested: <strong>{verbLabel(sender.verdict)}</strong> ({sender.confidence.toFixed(2)})
            — {sender.reasoning}
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {VERBS.map((verb) => (
            <button
              key={verb}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDecide(verb);
              }}
              style={{
                ...verbBtn,
                fontWeight: verb === sender.verdict ? 700 : 500,
                borderColor: verb === sender.verdict ? color.fg : '#ccc',
              }}
              title={`${verbLabel(verb)} (${verb[0]!.toUpperCase()})`}
            >
              {verb[0]!.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const primaryBtn: CSSProperties = {
  display: 'inline-block',
  textAlign: 'center',
  padding: '10px 14px',
  background: '#111',
  color: '#fff',
  borderRadius: 8,
  textDecoration: 'none',
  fontWeight: 600,
  fontSize: 14,
};

const ghostBtn: CSSProperties = {
  display: 'inline-block',
  textAlign: 'center',
  padding: '10px 14px',
  color: '#111',
  borderRadius: 8,
  textDecoration: 'none',
  fontSize: 14,
};

const verbBtn: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 8,
  border: '1px solid #ccc',
  background: '#fff',
  cursor: 'pointer',
  fontSize: 13,
};
