'use client';
// revamp-lab · Direction 1 — THE STACK
// One decision at a time, full focus. Session-based ritual with physical
// momentum: keycaps, card exit, done pile, receipt. IA collapses to three
// spaces (Today / Senders / Rules). THROWAWAY — off-constitution visuals.

import { useCallback, useEffect, useRef, useState } from 'react';
import { VERB_REGISTRY, verbById, type VerbId } from '@declutrmail/shared/actions';
import { PRIVACY_BADGE_HEADLINE } from '@declutrmail/shared';
import {
  LAB_SENDERS,
  isTypingTarget,
  previewCopy,
  sessionTotals,
  type LabSender,
  type ResolvedAction,
} from './fixtures';

const C = {
  bg: '#F4F2ED',
  card: '#FFFFFF',
  ink: '#16130E',
  soft: '#6F6A5E',
  line: '#E5E1D8',
  indigo: '#4F46E5',
  indigoSoft: '#EEF0FF',
  teal: '#0F766E',
  amber: '#B45309',
  red: '#B91C1C',
  dark: '#1C1917',
} as const;

const grotesk = 'var(--lab-grotesk), system-ui, sans-serif';
const mono = 'var(--dm-font-mono), monospace';

function toneStyle(verb: VerbId, disabled: boolean): React.CSSProperties {
  const t = verbById(verb).tone;
  const base: React.CSSProperties = {
    background: C.card,
    color: C.ink,
    border: `1px solid ${C.line}`,
  };
  if (t === 'dark')
    Object.assign(base, { background: C.dark, color: '#fff', border: `1px solid ${C.dark}` });
  if (t === 'amber')
    Object.assign(base, { background: C.amber, color: '#fff', border: `1px solid ${C.amber}` });
  if (t === 'danger')
    Object.assign(base, { background: C.card, color: C.red, border: `1px solid ${C.red}55` });
  if (verb === 'keep') Object.assign(base, { border: `1px solid ${C.teal}77`, color: C.teal });
  if (disabled) Object.assign(base, { opacity: 0.32, cursor: 'not-allowed' });
  return base;
}

export function StackDirection({ mobile }: { mobile: boolean }) {
  const [queue, setQueue] = useState<LabSender[]>(LAB_SENDERS);
  const [resolved, setResolved] = useState<ResolvedAction[]>([]);
  const [preview, setPreview] = useState<VerbId | null>(null);
  const [exiting, setExiting] = useState(false);
  const [pressed, setPressed] = useState<string | null>(null);
  const [toast, setToast] = useState<ResolvedAction | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [drag, setDrag] = useState(0);
  const dragStart = useRef<number | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = queue[0];
  const total = LAB_SENDERS.length;

  const exitingRef = useRef(false);
  const seqRef = useRef(0); // monotonic ledger key — length+1 collides after undo
  const finish = useCallback(
    (verb: VerbId) => {
      // Confirm must be idempotent. A ref gates re-entry synchronously —
      // React state (`exiting`) doesn't flush within the same tick, so a
      // burst of ⏎ events would all see stale state and multi-commit.
      if (!current || exitingRef.current) return;
      exitingRef.current = true;
      setExiting(true);
      const sender = current;
      setTimeout(() => {
        setResolved((r) => {
          // Invariant: one ledger entry per sender per session.
          if (r.some((x) => x.sender.id === sender.id)) return r;
          const next: ResolvedAction = { sender, verb, at: ++seqRef.current };
          setToast(next);
          if (toastTimer.current) clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(() => setToast(null), 6000);
          return [...r, next];
        });
        // Remove by id, not position — an undo landing mid-animation unshifts
        // a restored sender at [0], which a positional slice would eat.
        setQueue((q) => q.filter((x) => x.id !== sender.id));
        setPreview(null);
        exitingRef.current = false;
        setExiting(false);
        setDrag(0);
      }, 260);
    },
    [current],
  );

  const act = useCallback(
    (verb: VerbId) => {
      if (!current || exiting) return;
      if (verb === 'unsubscribe' && current.unsubChannel === null) {
        setHint(
          'No unsubscribe channel on this sender — banks rarely offer one. Archive handles it.',
        );
        setTimeout(() => setHint(null), 3500);
        return;
      }
      // D226: destructive verbs preview first; Keep fires directly.
      if (verbById(verb).destructive) setPreview(verb);
      else finish(verb);
    },
    [current, exiting, finish],
  );

  const undo = useCallback(() => {
    setResolved((r) => {
      const last = r[r.length - 1];
      if (!last) return r;
      setQueue((q) => [last.sender, ...q]);
      setToast(null);
      return r.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') return setPreview(null);
      if (k === 'enter' && preview) return finish(preview);
      if (k === 'z') return undo();
      const spec = VERB_REGISTRY.find((v) => v.shortcut.toLowerCase() === k);
      if (spec && !preview) {
        setPressed(spec.id);
        setTimeout(() => setPressed(null), 160);
        act(spec.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, finish, preview, undo]);

  // Mobile swipe-right = recommended verb (preview still gates commit, D226).
  const onPointerDown = (e: React.PointerEvent) => {
    if (!mobile || preview) return;
    dragStart.current = e.clientX;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragStart.current === null) return;
    setDrag(Math.max(0, e.clientX - dragStart.current));
  };
  const onPointerUp = () => {
    if (dragStart.current === null) return;
    if (drag > 90 && current) act(current.recommended);
    dragStart.current = null;
    setDrag(0);
  };

  const totals = sessionTotals(resolved);

  return (
    <div
      style={{
        minHeight: mobile ? undefined : '100dvh',
        height: mobile ? '100%' : undefined,
        overflow: mobile ? 'hidden' : undefined,
        position: 'relative',
        background: C.bg,
        color: C.ink,
        fontFamily: grotesk,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 3-space nav — the IA challenge: Today / Senders / Rules, nothing else */}
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
        <nav
          aria-label="Lab nav (decorative)"
          style={{
            display: 'flex',
            gap: 2,
            background: '#EAE7DE',
            borderRadius: 999,
            padding: 3,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {(['Today', 'Senders', 'Rules'] as const).map((s, i) => (
            <span
              key={s}
              title={i === 0 ? undefined : 'Lab: decorative'}
              style={{
                padding: '6px 16px',
                borderRadius: 999,
                background: i === 0 ? C.ink : 'transparent',
                color: i === 0 ? '#fff' : C.soft,
                cursor: 'default',
              }}
            >
              {s}
            </span>
          ))}
        </nav>
        {!mobile && (
          <div style={{ fontFamily: mono, fontSize: 11, color: C.teal, letterSpacing: '0.06em' }}>
            {PRIVACY_BADGE_HEADLINE.toUpperCase()}
          </div>
        )}
      </header>

      <main
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: mobile ? 'auto' : undefined,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          padding: mobile ? '8px 16px 120px' : '24px 32px 48px',
        }}
      >
        {current ? (
          <>
            {/* Session header + progress */}
            <div style={{ width: mobile ? '100%' : 560, marginBottom: 18 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  fontFamily: mono,
                  fontSize: 11,
                  letterSpacing: '0.08em',
                  color: C.soft,
                }}
              >
                <span>MORNING SWEEP</span>
                <span>
                  {resolved.length + 1} / {total}
                </span>
              </div>
              <div style={{ height: 4, background: '#E2DED2', borderRadius: 999, marginTop: 8 }}>
                <div
                  style={{
                    height: 4,
                    width: `${(resolved.length / total) * 100}%`,
                    background: C.indigo,
                    borderRadius: 999,
                    transition: 'width 240ms ease',
                  }}
                />
              </div>
            </div>

            {/* The card — one decision, full focus */}
            <div style={{ position: 'relative', width: mobile ? '100%' : 560 }}>
              {queue[1] && (
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    inset: 0,
                    transform: 'scale(0.955) translateY(14px)',
                    background: C.card,
                    borderRadius: 20,
                    border: `1px solid ${C.line}`,
                  }}
                />
              )}
              <section
                aria-label={`Decision: ${current.name}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                style={{
                  position: 'relative',
                  background: C.card,
                  borderRadius: 20,
                  border: `1px solid ${C.line}`,
                  boxShadow: '0 24px 48px -24px rgba(22,19,14,0.18)',
                  padding: mobile ? 20 : 28,
                  overflow: 'hidden',
                  touchAction: mobile ? 'pan-y' : undefined,
                  transform: exiting
                    ? 'translateX(140%) rotate(8deg)'
                    : drag > 0
                      ? `translateX(${drag}px) rotate(${Math.min(6, drag / 18)}deg)`
                      : undefined,
                  opacity: exiting ? 0 : 1,
                  transition:
                    drag > 0
                      ? undefined
                      : 'transform 260ms cubic-bezier(.3,.7,.4,1), opacity 260ms ease',
                }}
              >
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  <div
                    aria-hidden
                    style={{
                      width: 46,
                      height: 46,
                      borderRadius: 14,
                      background: C.indigoSoft,
                      color: C.indigo,
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 800,
                      fontSize: 19,
                    }}
                  >
                    {current.name[0]}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: mobile ? 19 : 22,
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {current.name}
                      {current.protected && (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 10,
                            fontFamily: mono,
                            color: C.teal,
                            border: `1px solid ${C.teal}55`,
                            borderRadius: 999,
                            padding: '2px 8px',
                            verticalAlign: 'middle',
                          }}
                        >
                          PROTECTED
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontFamily: mono,
                        fontSize: 12,
                        color: C.soft,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {current.email}
                    </div>
                  </div>
                </div>

                {/* Recommendation + reasoning */}
                <div
                  style={{
                    marginTop: 18,
                    background: '#FAF8F3',
                    border: `1px solid ${C.line}`,
                    borderRadius: 12,
                    padding: '12px 14px',
                  }}
                >
                  <div
                    style={{
                      fontFamily: mono,
                      fontSize: 10,
                      letterSpacing: '0.08em',
                      color: C.soft,
                    }}
                  >
                    ENGINE — {verbById(current.recommended).label.toUpperCase()} ·{' '}
                    {current.confidence}%
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.5, marginTop: 6 }}>
                    {current.reasoning}
                  </div>
                </div>

                {/* Evidence */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: mobile ? '1fr 1fr' : 'repeat(4, 1fr)',
                    gap: 10,
                    marginTop: 14,
                  }}
                >
                  {[
                    [`${current.perMonth}`, 'PER MONTH'],
                    [`${Math.round(current.readRate * 100)}%`, 'READ RATE'],
                    [
                      current.lastSeenDays === 0 ? 'today' : `${current.lastSeenDays}d ago`,
                      'LAST EMAIL',
                    ],
                    [current.lifetime.toLocaleString('en-US'), 'ALL-TIME'],
                  ].map(([v, l]) => (
                    <div
                      key={l}
                      style={{
                        border: `1px solid ${C.line}`,
                        borderRadius: 12,
                        padding: '10px 12px',
                      }}
                    >
                      <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em' }}>
                        {v}
                      </div>
                      <div
                        style={{
                          fontFamily: mono,
                          fontSize: 9.5,
                          letterSpacing: '0.08em',
                          color: C.soft,
                          marginTop: 2,
                        }}
                      >
                        {l}
                      </div>
                    </div>
                  ))}
                </div>

                {mobile && (
                  <div
                    style={{
                      marginTop: 14,
                      textAlign: 'center',
                      fontFamily: mono,
                      fontSize: 11,
                      color: C.soft,
                    }}
                  >
                    swipe right → {verbById(current.recommended).label}
                  </div>
                )}

                {/* D226 preview — slides over card bottom, gates every destructive commit */}
                {preview && (
                  <div
                    role="dialog"
                    aria-label="Action preview"
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: C.ink,
                      color: '#F5F2EA',
                      padding: mobile ? 16 : 20,
                      borderRadius: '16px 16px 20px 20px',
                    }}
                  >
                    <div
                      style={{
                        fontFamily: mono,
                        fontSize: 10,
                        letterSpacing: '0.1em',
                        color: '#B9B2A2',
                      }}
                    >
                      PREVIEW — NOTHING HAS CHANGED YET
                    </div>
                    {(() => {
                      const p = previewCopy(preview, current);
                      return (
                        <div
                          style={{
                            marginTop: 10,
                            display: 'grid',
                            gap: 6,
                            fontSize: 13.5,
                            lineHeight: 1.45,
                          }}
                        >
                          <div>→ {p.does}</div>
                          <div style={{ color: '#B9B2A2' }}>✕ {p.doesNot}</div>
                          <div style={{ color: '#8BD8CB' }}>↩ {p.undo}</div>
                        </div>
                      );
                    })()}
                    <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                      <button
                        onClick={() => finish(preview)}
                        style={{
                          background: C.indigo,
                          color: '#fff',
                          border: 'none',
                          borderRadius: 10,
                          padding: '10px 18px',
                          fontFamily: grotesk,
                          fontWeight: 700,
                          fontSize: 14,
                          cursor: 'pointer',
                        }}
                      >
                        Confirm {!mobile && '⏎'}
                      </button>
                      <button
                        onClick={() => setPreview(null)}
                        style={{
                          background: 'transparent',
                          color: '#B9B2A2',
                          border: '1px solid rgba(255,255,255,0.25)',
                          borderRadius: 10,
                          padding: '10px 18px',
                          fontFamily: grotesk,
                          fontWeight: 600,
                          fontSize: 14,
                          cursor: 'pointer',
                        }}
                      >
                        Back {!mobile && '⎋'}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </div>

            {hint && (
              <div
                style={{
                  marginTop: 12,
                  width: mobile ? '100%' : 560,
                  fontSize: 13,
                  color: C.amber,
                  background: '#FBF4E9',
                  border: `1px solid ${C.amber}44`,
                  borderRadius: 10,
                  padding: '10px 14px',
                }}
              >
                {hint}
              </div>
            )}

            {/* Keycaps — the piano. Registry-driven, separator before Delete. */}
            <div
              style={
                mobile
                  ? {
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: 'rgba(244,242,237,0.96)',
                      borderTop: `1px solid ${C.line}`,
                      padding: '12px 16px calc(14px + env(safe-area-inset-bottom))',
                      display: 'flex',
                      gap: 8,
                      justifyContent: 'center',
                      zIndex: 20,
                    }
                  : { display: 'flex', gap: 14, marginTop: 26, alignItems: 'flex-end' }
              }
            >
              {VERB_REGISTRY.map((v) => {
                const disabled = v.id === 'unsubscribe' && current.unsubChannel === null;
                const isPressed = pressed === v.id;
                return (
                  <div key={v.id} style={{ display: 'flex', alignItems: 'flex-end', gap: 14 }}>
                    {'separator' in v && v.separator && !mobile && (
                      <div
                        aria-hidden
                        style={{ width: 1, height: 40, background: C.line, margin: '0 2px' }}
                      />
                    )}
                    <button
                      onClick={() => act(v.id)}
                      disabled={disabled}
                      title={disabled ? 'No unsubscribe channel on this sender' : undefined}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 6,
                        background: 'none',
                        border: 'none',
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        padding: 0,
                      }}
                    >
                      <span
                        aria-hidden={mobile}
                        style={{
                          ...toneStyle(v.id, disabled),
                          width: mobile ? 52 : 46,
                          height: mobile ? 44 : 46,
                          borderRadius: 12,
                          display: 'grid',
                          placeItems: 'center',
                          fontWeight: 800,
                          fontSize: 16,
                          fontFamily: grotesk,
                          borderBottomWidth: isPressed ? 1 : 4,
                          transform: isPressed ? 'translateY(3px)' : undefined,
                          transition: 'transform 80ms ease, border-bottom-width 80ms ease',
                        }}
                      >
                        {mobile ? v.label[0] : v.shortcut}
                      </span>
                      <span
                        style={{
                          fontSize: mobile ? 10 : 11.5,
                          fontWeight: 600,
                          color: disabled ? '#B5B0A4' : C.soft,
                        }}
                      >
                        {v.label}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Done pile */}
            {resolved.length > 0 && (
              <div
                style={{
                  marginTop: mobile ? 16 : 28,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontFamily: mono,
                  fontSize: 11,
                  color: C.soft,
                }}
              >
                <span aria-hidden style={{ display: 'flex' }}>
                  {resolved.slice(-5).map((r) => (
                    <span
                      key={r.at}
                      style={{
                        width: 14,
                        height: 18,
                        background: C.card,
                        border: `1px solid ${C.line}`,
                        borderRadius: 3,
                        marginLeft: -6,
                        transform: `rotate(${(r.at % 3) - 1}deg)`,
                      }}
                    />
                  ))}
                </span>
                {resolved.length} decided · Z undoes
              </div>
            )}
          </>
        ) : (
          /* ——— RECEIPT: the share moment + anti-engagement done state ——— */
          <div
            style={{
              width: mobile ? '100%' : 640,
              textAlign: 'center',
              paddingTop: mobile ? 12 : 40,
            }}
          >
            <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.1em', color: C.soft }}>
              MORNING SWEEP
            </div>
            <h2
              style={{
                fontSize: mobile ? 34 : 44,
                fontWeight: 800,
                letterSpacing: '-0.03em',
                margin: '10px 0 6px',
              }}
            >
              Swept.
            </h2>
            <p style={{ color: C.soft, fontSize: 15, margin: 0 }}>
              {totals.decided} decisions · {totals.emails.toLocaleString('en-US')} emails handled ·{' '}
              {totals.byVerb.unsubscribe} unsubscribed
            </p>

            <div
              style={{
                margin: '28px auto 0',
                width: mobile ? '100%' : 420,
                background: C.indigo,
                color: '#fff',
                borderRadius: 20,
                padding: 26,
                textAlign: 'left',
                boxShadow: '0 24px 48px -20px rgba(79,70,229,0.45)',
              }}
            >
              <div
                style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', opacity: 0.75 }}
              >
                DECLUTRMAIL — CLEANUP RECEIPT
              </div>
              <div
                style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.03em', marginTop: 10 }}
              >
                {totals.emails.toLocaleString('en-US')}
              </div>
              <div style={{ fontSize: 13, opacity: 0.85 }}>emails handled this morning</div>
              <div style={{ display: 'flex', gap: 18, marginTop: 16, fontSize: 13 }}>
                <span>
                  <b>{totals.decided}</b> senders decided
                </span>
                <span>
                  <b>{totals.byVerb.unsubscribe}</b> unsubscribed
                </span>
              </div>
              <div
                style={{
                  marginTop: 18,
                  paddingTop: 14,
                  borderTop: '1px solid rgba(255,255,255,0.25)',
                  fontFamily: mono,
                  fontSize: 10.5,
                  opacity: 0.8,
                }}
              >
                {PRIVACY_BADGE_HEADLINE} · every action reversible
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
              {['Copy link', 'Save image'].map((b) => (
                <button
                  key={b}
                  onClick={() =>
                    setHint('Lab mock — real share card ships after the direction pick.')
                  }
                  style={{
                    background: C.card,
                    border: `1px solid ${C.line}`,
                    borderRadius: 10,
                    padding: '10px 18px',
                    fontFamily: grotesk,
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  {b}
                </button>
              ))}
            </div>
            {hint && <div style={{ marginTop: 10, fontSize: 12.5, color: C.soft }}>{hint}</div>}

            <p style={{ marginTop: 34, fontSize: 15, color: C.soft }}>
              Done. Close the tab — <b style={{ color: C.ink }}>we&apos;ll hold the door.</b>
            </p>
            <button
              onClick={() => {
                setQueue(LAB_SENDERS);
                setResolved([]);
                setToast(null);
              }}
              style={{
                marginTop: 8,
                background: 'none',
                border: `1px solid ${C.line}`,
                borderRadius: 999,
                padding: '8px 18px',
                fontFamily: mono,
                fontSize: 11,
                color: C.soft,
                cursor: 'pointer',
              }}
            >
              RESET DEMO
            </button>
          </div>
        )}
      </main>

      {/* Undo toast */}
      {toast && (
        <div
          style={{
            position: mobile ? 'absolute' : 'fixed',
            bottom: mobile ? 86 : 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: C.ink,
            color: '#F5F2EA',
            borderRadius: 999,
            padding: '10px 12px 10px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 13,
            boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
            zIndex: 30,
            whiteSpace: 'nowrap',
          }}
        >
          {verbById(toast.verb).label} — {toast.sender.name}
          {toast.verb !== 'keep' && ` · ${toast.sender.lifetime.toLocaleString('en-US')} emails`}
          <button
            onClick={undo}
            style={{
              background: '#F5F2EA',
              color: C.ink,
              border: 'none',
              borderRadius: 999,
              padding: '6px 14px',
              fontWeight: 800,
              fontSize: 12,
              fontFamily: grotesk,
              cursor: 'pointer',
            }}
          >
            UNDO{!mobile && ' (Z)'}
          </button>
        </div>
      )}
    </div>
  );
}
