'use client';
// revamp-lab · Direction 2 — THE CONSOLE
// Everything on one screen: cohort rail, dense queue, evidence panel,
// live system status. Keyboard-native (j/k + K/A/U/L/D, no expand step),
// inline previews, batch ops. Control-room register. THROWAWAY.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VERB_REGISTRY, verbById, type VerbId } from '@declutrmail/shared/actions';
import { PRIVACY_BADGE_HEADLINE } from '@declutrmail/shared';
import {
  LAB_COHORTS,
  LAB_SENDERS,
  isTypingTarget,
  previewCopy,
  sessionTotals,
  type LabSender,
  type ResolvedAction,
} from './fixtures';

const C = {
  bg: '#0E1114',
  panel: '#14181C',
  panel2: '#191E23',
  line: 'rgba(255,255,255,0.07)',
  text: '#E8EAEC',
  dim: '#9AA3AB',
  faint: '#6B747C',
  teal: '#2DD4BF',
  amber: '#FBBF24',
  red: '#F87171',
  green: '#4ADE80',
} as const;

const ui = 'var(--lab-intertight), system-ui, sans-serif';
const mono = 'var(--dm-font-mono), monospace';

function toneColor(verb: VerbId): string {
  const t = verbById(verb).tone;
  if (t === 'amber') return C.amber;
  if (t === 'danger') return C.red;
  if (t === 'dark') return C.dim;
  return C.teal;
}

function spark(s: LabSender): string {
  // deterministic pseudo-sparkline from id — lab only
  const pts: string[] = [];
  for (let i = 0; i < 12; i++) {
    const v = ((s.id.charCodeAt(i % s.id.length) * (i + 3)) % 17) + 2;
    pts.push(`${i * 10},${24 - v}`);
  }
  return pts.join(' ');
}

export function ConsoleDirection({ mobile }: { mobile: boolean }) {
  const [queue, setQueue] = useState<LabSender[]>(LAB_SENDERS);
  const [log, setLog] = useState<ResolvedAction[]>([]);
  const [focus, setFocus] = useState(0);
  const [preview, setPreview] = useState<VerbId | null>(null);
  const [batchPreview, setBatchPreview] = useState(false);
  const [batchDone, setBatchDone] = useState(false);
  const [sheet, setSheet] = useState(false); // mobile evidence sheet
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current: LabSender | undefined = queue[Math.min(focus, queue.length - 1)];

  const say = useCallback((m: string) => {
    setFlash(m);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 3200);
  }, []);

  const commit = useCallback(
    (verb: VerbId) => {
      if (!current) return;
      const sender = current;
      setLog((l) => [...l, { sender, verb, at: l.length + 1 }]);
      setQueue((q) => q.filter((x) => x.id !== sender.id));
      setFocus((f) => Math.max(0, Math.min(f, queue.length - 2)));
      setPreview(null);
      setSheet(false);
    },
    [current, queue.length],
  );

  const act = useCallback(
    (verb: VerbId) => {
      if (!current) return;
      if (verb === 'unsubscribe' && current.unsubChannel === null) {
        say('NO UNSUB CHANNEL — transactional sender. A archives it instead.');
        return;
      }
      if (verbById(verb).destructive) setPreview(verb);
      else commit(verb);
    },
    [commit, current, say],
  );

  const undo = useCallback(() => {
    setLog((l) => {
      const last = l[l.length - 1];
      if (!last) return l;
      setQueue((q) => [last.sender, ...q]);
      setFocus(0);
      say(`UNDONE — ${last.verb.toUpperCase()} ${last.sender.domain} restored to queue.`);
      return l.slice(0, -1);
    });
  }, [say]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      // Arrows move focus. Deliberately NOT vim j/k: K is the Keep verb
      // (product vocabulary wins over navigation convention).
      if (k === 'arrowdown') {
        e.preventDefault();
        setPreview(null);
        setFocus((f) => Math.min(f + 1, queue.length - 1));
        return;
      }
      if (k === 'arrowup') {
        e.preventDefault();
        setPreview(null);
        setFocus((f) => Math.max(f - 1, 0));
        return;
      }
      if (k === 'escape') {
        setPreview(null);
        setBatchPreview(false);
        return;
      }
      if (k === 'enter') {
        if (preview) commit(preview);
        else if (batchPreview) {
          setBatchPreview(false);
          setBatchDone(true);
          say('BATCH STAGED — archive 555 quiet senders (lab mock).');
        }
        return;
      }
      if (k === 'z') return undo();
      // NOTE: 'k' collides between vim-up and Keep. Console resolves it the
      // Superhuman way: k = Keep (product verb wins), arrows move focus.
      const spec = VERB_REGISTRY.find((v) => v.shortcut.toLowerCase() === k);
      if (spec) act(spec.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, batchPreview, commit, preview, queue.length, say, undo]);

  const totals = sessionTotals(log);
  const cohorts = useMemo(
    () =>
      [
        ['DECIDE', queue.length, true],
        ['QUIET', LAB_COHORTS.quiet, false],
        ['DORMANT', LAB_COHORTS.dormant, false],
        ['PROTECTED', LAB_COHORTS.protected, false],
        ['ALL', LAB_COHORTS.all, false],
      ] as const,
    [queue.length],
  );

  const evidence = current && (
    <div style={{ padding: 16 }}>
      <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', color: C.faint }}>
        EVIDENCE
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8 }}>{current.name}</div>
      <div style={{ fontFamily: mono, fontSize: 11, color: C.dim, marginBottom: 12 }}>
        {current.email}
      </div>
      <svg width="120" height="26" aria-hidden style={{ display: 'block', marginBottom: 12 }}>
        <polyline
          points={spark(current)}
          fill="none"
          stroke={C.teal}
          strokeWidth="1.5"
          opacity="0.8"
        />
      </svg>
      <div style={{ fontSize: 12.5, lineHeight: 1.55, color: C.text }}>{current.reasoning}</div>
      <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
        {current.signals.map((sig) => (
          <div key={sig} style={{ fontFamily: mono, fontSize: 10.5, color: C.dim }}>
            ▸ {sig}
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 14,
          borderTop: `1px solid ${C.line}`,
          paddingTop: 10,
          display: 'grid',
          gap: 5,
        }}
      >
        {[
          ['CONFIDENCE', `${current.confidence}%`],
          ['CHANNEL', current.unsubChannel ?? 'none'],
          ['LIFETIME', current.lifetime.toLocaleString('en-US')],
        ].map(([l, v]) => (
          <div
            key={l}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontFamily: mono,
              fontSize: 10.5,
            }}
          >
            <span style={{ color: C.faint }}>{l}</span>
            <span style={{ color: C.text }}>{v}</span>
          </div>
        ))}
      </div>
      {mobile && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          {VERB_REGISTRY.map((v) => {
            const disabled = v.id === 'unsubscribe' && current.unsubChannel === null;
            return (
              <button
                key={v.id}
                disabled={disabled}
                onClick={() => act(v.id)}
                style={{
                  background: 'transparent',
                  border: `1px solid ${disabled ? C.line : toneColor(v.id)}`,
                  color: disabled ? C.faint : toneColor(v.id),
                  borderRadius: 8,
                  padding: '8px 14px',
                  fontFamily: ui,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                {v.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div
      style={{
        minHeight: mobile ? undefined : '100dvh',
        height: mobile ? '100%' : undefined,
        overflow: mobile ? 'hidden' : undefined,
        position: 'relative',
        background: C.bg,
        color: C.text,
        fontFamily: ui,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top strip */}
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
          DECLUTR<span style={{ color: C.teal }}>MAIL</span>{' '}
          <span style={{ fontFamily: mono, fontSize: 10, color: C.faint, marginLeft: 8 }}>
            OPERATOR CONSOLE
          </span>
        </div>
        <div
          style={{
            fontFamily: mono,
            fontSize: 10.5,
            color: C.green,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: C.green,
              display: 'inline-block',
            }}
          />
          {PRIVACY_BADGE_HEADLINE.toUpperCase()}
        </div>
      </header>

      {/* Mobile cohort chips */}
      {mobile && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: '10px 14px',
            overflowX: 'auto',
            borderBottom: `1px solid ${C.line}`,
          }}
        >
          {cohorts.map(([label, n, active]) => (
            <span
              key={label}
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                whiteSpace: 'nowrap',
                padding: '6px 10px',
                borderRadius: 6,
                border: `1px solid ${active ? C.teal : C.line}`,
                color: active ? C.teal : C.dim,
              }}
            >
              {label} {n.toLocaleString('en-US')}
            </span>
          ))}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Left rail */}
        {!mobile && (
          <aside
            style={{
              width: 216,
              borderRight: `1px solid ${C.line}`,
              display: 'flex',
              flexDirection: 'column',
              padding: '14px 0',
            }}
          >
            <div style={{ padding: '0 16px', display: 'grid', gap: 2 }}>
              {cohorts.map(([label, n, active]) => (
                <div
                  key={label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: active ? C.panel2 : 'transparent',
                    borderLeft: `2px solid ${active ? C.teal : 'transparent'}`,
                    fontFamily: mono,
                    fontSize: 11,
                    color: active ? C.text : C.dim,
                  }}
                >
                  <span>{label}</span>
                  <span>{n.toLocaleString('en-US')}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => setBatchPreview(true)}
              disabled={batchDone}
              style={{
                margin: '14px 16px 0',
                background: 'transparent',
                border: `1px dashed ${batchDone ? C.line : C.amber}66`,
                color: batchDone ? C.faint : C.amber,
                borderRadius: 8,
                padding: '9px 10px',
                fontFamily: mono,
                fontSize: 10.5,
                letterSpacing: '0.04em',
                cursor: batchDone ? 'default' : 'pointer',
                textAlign: 'left',
              }}
            >
              {batchDone ? '✓ QUIET BATCH STAGED' : '⚡ BATCH: ARCHIVE 555 QUIET'}
            </button>
            <div
              style={{
                marginTop: 'auto',
                padding: '14px 16px 4px',
                borderTop: `1px solid ${C.line}`,
              }}
            >
              {[
                ['UNDO WINDOW', '7 DAYS', C.teal],
                ['SESSION', `${totals.decided} DECIDED`, C.dim],
                ['EMAILS HANDLED', totals.emails.toLocaleString('en-US'), C.dim],
              ].map(([l, v, col]) => (
                <div
                  key={l}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontFamily: mono,
                    fontSize: 10,
                    padding: '3px 0',
                  }}
                >
                  <span style={{ color: C.faint }}>{l}</span>
                  <span style={{ color: col }}>{v}</span>
                </div>
              ))}
            </div>
          </aside>
        )}

        {/* Center queue */}
        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {batchPreview && (
            <div
              role="dialog"
              aria-label="Batch preview"
              style={{
                margin: mobile ? 12 : 16,
                border: `1px solid ${C.amber}66`,
                background: 'rgba(251,191,36,0.06)',
                borderRadius: 10,
                padding: 14,
                fontSize: 13,
              }}
            >
              <div
                style={{ fontFamily: mono, fontSize: 10, color: C.amber, letterSpacing: '0.08em' }}
              >
                BATCH PREVIEW — NOTHING HAS CHANGED YET
              </div>
              <div style={{ marginTop: 8, lineHeight: 1.5 }}>
                → Archives mail from <b>555 quiet senders</b> as one staged batch. ✕ No deletions,
                protected senders untouched. ↩ Reversible for 7 days as a single undo.
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <button
                  onClick={() => {
                    setBatchPreview(false);
                    setBatchDone(true);
                    say('BATCH STAGED — archive 555 quiet senders (lab mock).');
                  }}
                  style={{
                    background: C.amber,
                    color: '#0E1114',
                    border: 'none',
                    borderRadius: 8,
                    padding: '8px 16px',
                    fontWeight: 700,
                    fontSize: 12.5,
                    fontFamily: ui,
                    cursor: 'pointer',
                  }}
                >
                  Commit batch ⏎
                </button>
                <button
                  onClick={() => setBatchPreview(false)}
                  style={{
                    background: 'transparent',
                    color: C.dim,
                    border: `1px solid ${C.line}`,
                    borderRadius: 8,
                    padding: '8px 16px',
                    fontSize: 12.5,
                    fontFamily: ui,
                    cursor: 'pointer',
                  }}
                >
                  Abort ⎋
                </button>
              </div>
            </div>
          )}

          {queue.length > 0 ? (
            <div style={{ flex: 1, overflowY: 'auto', padding: mobile ? '4px 0 90px' : '4px 0' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: mobile
                    ? '1fr auto'
                    : 'minmax(0,1.6fr) 90px 90px minmax(0,1fr)',
                  padding: mobile ? '8px 14px' : '8px 20px',
                  fontFamily: mono,
                  fontSize: 9.5,
                  letterSpacing: '0.1em',
                  color: C.faint,
                  borderBottom: `1px solid ${C.line}`,
                }}
              >
                <span>SENDER</span>
                {!mobile && <span>VOL/MO</span>}
                {!mobile && <span>READ</span>}
                <span>ENGINE</span>
              </div>
              {queue.map((s, i) => {
                const focused = i === focus;
                return (
                  <div key={s.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setFocus(i);
                        setPreview(null);
                        if (mobile) setSheet(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !preview) {
                          setFocus(i);
                          if (mobile) setSheet(true);
                        }
                      }}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: mobile
                          ? '1fr auto'
                          : 'minmax(0,1.6fr) 90px 90px minmax(0,1fr)',
                        alignItems: 'center',
                        padding: mobile ? '12px 14px' : '10px 20px',
                        background: focused ? C.panel2 : 'transparent',
                        borderLeft: `2px solid ${focused ? C.teal : 'transparent'}`,
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                    >
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontWeight: 600 }}>{s.name}</span>
                        {s.protected && (
                          <span
                            style={{ fontFamily: mono, fontSize: 9, color: C.teal, marginLeft: 8 }}
                          >
                            ◆ PROTECTED
                          </span>
                        )}
                        <span
                          style={{
                            display: 'block',
                            fontFamily: mono,
                            fontSize: 10.5,
                            color: C.faint,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {s.email}
                        </span>
                      </span>
                      {!mobile && (
                        <span style={{ fontFamily: mono, fontSize: 12, color: C.dim }}>
                          {s.perMonth}
                        </span>
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

                    {/* Inline preview strip (D226) under the focused row */}
                    {focused && preview && !mobile && current && (
                      <div
                        role="dialog"
                        aria-label="Action preview"
                        style={{
                          margin: '0 20px 8px',
                          borderLeft: `2px solid ${toneColor(preview)}`,
                          background: C.panel,
                          padding: '10px 14px',
                          fontSize: 12.5,
                          lineHeight: 1.5,
                        }}
                      >
                        {(() => {
                          const p = previewCopy(preview, current);
                          return (
                            <span>
                              <b style={{ color: toneColor(preview) }}>
                                {verbById(preview).label.toUpperCase()}
                              </b>{' '}
                              — {p.does} <span style={{ color: C.faint }}>{p.doesNot}</span>{' '}
                              <span style={{ color: C.teal }}>{p.undo}</span>
                              <span
                                style={{
                                  fontFamily: mono,
                                  fontSize: 10,
                                  color: C.faint,
                                  marginLeft: 10,
                                }}
                              >
                                ⏎ COMMIT · ⎋ ABORT
                              </span>
                            </span>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* Queue clear — terminal receipt */
            <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 20 }}>
              <div style={{ width: mobile ? '100%' : 460 }}>
                <div
                  style={{ fontFamily: mono, fontSize: 11, color: C.green, letterSpacing: '0.1em' }}
                >
                  ▮ QUEUE CLEAR — 0 PENDING
                </div>
                <div
                  style={{
                    marginTop: 14,
                    border: `1px solid ${C.line}`,
                    borderRadius: 10,
                    background: C.panel,
                    padding: 18,
                    fontFamily: mono,
                    fontSize: 12,
                    lineHeight: 1.9,
                  }}
                >
                  <div style={{ color: C.faint }}>── CLEANUP RECEIPT ──────────────</div>
                  <div>
                    SENDERS DECIDED{' '}
                    <span style={{ float: 'right', color: C.teal }}>{totals.decided}</span>
                  </div>
                  <div>
                    EMAILS HANDLED{' '}
                    <span style={{ float: 'right', color: C.teal }}>
                      {totals.emails.toLocaleString('en-US')}
                    </span>
                  </div>
                  <div>
                    UNSUBSCRIBED{' '}
                    <span style={{ float: 'right', color: C.amber }}>
                      {totals.byVerb.unsubscribe}
                    </span>
                  </div>
                  <div>
                    {PRIVACY_BADGE_HEADLINE.toUpperCase()}{' '}
                    <span style={{ float: 'right', color: C.green }}>✓</span>
                  </div>
                  <div style={{ color: C.faint }}>─────────────────────────────────</div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    onClick={() => say('LAB MOCK — real share card ships post-pick.')}
                    style={{
                      background: C.teal,
                      color: '#0E1114',
                      border: 'none',
                      borderRadius: 8,
                      padding: '9px 16px',
                      fontWeight: 700,
                      fontSize: 12.5,
                      fontFamily: ui,
                      cursor: 'pointer',
                    }}
                  >
                    Copy receipt
                  </button>
                  <button
                    onClick={() => {
                      setQueue(LAB_SENDERS);
                      setLog([]);
                      setBatchDone(false);
                      setFocus(0);
                    }}
                    style={{
                      background: 'transparent',
                      color: C.dim,
                      border: `1px solid ${C.line}`,
                      borderRadius: 8,
                      padding: '9px 16px',
                      fontSize: 12.5,
                      fontFamily: ui,
                      cursor: 'pointer',
                    }}
                  >
                    Reset demo
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Session log */}
          {log.length > 0 && queue.length > 0 && (
            <div style={{ borderTop: `1px solid ${C.line}`, maxHeight: 132, overflowY: 'auto' }}>
              {[...log].reverse().map((r) => (
                <div
                  key={r.at}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: mobile ? '7px 14px' : '7px 20px',
                    fontFamily: mono,
                    fontSize: 10.5,
                    color: C.dim,
                  }}
                >
                  <span style={{ color: toneColor(r.verb) }}>{r.verb.toUpperCase()}</span>
                  <span style={{ textDecoration: 'line-through', opacity: 0.7 }}>
                    {r.sender.domain}
                  </span>
                  {r.verb !== 'keep' && (
                    <span>{r.sender.lifetime.toLocaleString('en-US')} msgs</span>
                  )}
                  <button
                    onClick={() => {
                      setLog((l) => l.filter((x) => x.at !== r.at));
                      setQueue((q) => [r.sender, ...q]);
                      setFocus(0);
                    }}
                    style={{
                      marginLeft: 'auto',
                      background: 'none',
                      border: `1px solid ${C.line}`,
                      color: C.teal,
                      borderRadius: 6,
                      padding: '2px 10px',
                      fontFamily: mono,
                      fontSize: 9.5,
                      cursor: 'pointer',
                    }}
                  >
                    UNDO
                  </button>
                </div>
              ))}
            </div>
          )}
        </main>

        {/* Right evidence panel */}
        {!mobile && current && (
          <aside style={{ width: 300, borderLeft: `1px solid ${C.line}`, overflowY: 'auto' }}>
            {evidence}
          </aside>
        )}
      </div>

      {/* Mobile evidence bottom sheet */}
      {mobile && sheet && current && (
        <div
          role="dialog"
          aria-label={`Evidence: ${current.name}`}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            background: C.panel2,
            borderTop: `1px solid ${C.line}`,
            borderRadius: '16px 16px 0 0',
            maxHeight: '70%',
            overflowY: 'auto',
            zIndex: 30,
            boxShadow: '0 -16px 40px rgba(0,0,0,0.5)',
          }}
        >
          <button
            onClick={() => setSheet(false)}
            aria-label="Close evidence"
            style={{
              position: 'sticky',
              top: 8,
              left: '100%',
              marginRight: 10,
              background: C.panel,
              color: C.dim,
              border: `1px solid ${C.line}`,
              borderRadius: 999,
              width: 28,
              height: 28,
              cursor: 'pointer',
            }}
          >
            ×
          </button>
          {/* Mobile preview inside sheet */}
          {preview ? (
            <div style={{ padding: 16 }}>
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 10,
                  color: toneColor(preview),
                  letterSpacing: '0.08em',
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
                      gap: 8,
                      fontSize: 13.5,
                      lineHeight: 1.5,
                    }}
                  >
                    <div>→ {p.does}</div>
                    <div style={{ color: C.dim }}>✕ {p.doesNot}</div>
                    <div style={{ color: C.teal }}>↩ {p.undo}</div>
                  </div>
                );
              })()}
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button
                  onClick={() => commit(preview)}
                  style={{
                    background: toneColor(preview),
                    color: '#0E1114',
                    border: 'none',
                    borderRadius: 8,
                    padding: '10px 18px',
                    fontWeight: 700,
                    fontSize: 13.5,
                    fontFamily: ui,
                    cursor: 'pointer',
                  }}
                >
                  Commit
                </button>
                <button
                  onClick={() => setPreview(null)}
                  style={{
                    background: 'transparent',
                    color: C.dim,
                    border: `1px solid ${C.line}`,
                    borderRadius: 8,
                    padding: '10px 18px',
                    fontSize: 13.5,
                    fontFamily: ui,
                    cursor: 'pointer',
                  }}
                >
                  Back
                </button>
              </div>
            </div>
          ) : (
            evidence
          )}
        </div>
      )}

      {flash && (
        <div
          style={{
            position: mobile ? 'absolute' : 'fixed',
            bottom: mobile ? 12 : 54,
            left: '50%',
            transform: 'translateX(-50%)',
            background: C.panel2,
            border: `1px solid ${C.line}`,
            color: C.text,
            fontFamily: mono,
            fontSize: 11,
            borderRadius: 8,
            padding: '8px 14px',
            zIndex: 40,
            maxWidth: '92%',
          }}
        >
          {flash}
        </div>
      )}

      {/* Status bar — the palette that teaches shortcuts */}
      {!mobile && (
        <footer
          style={{
            borderTop: `1px solid ${C.line}`,
            padding: '9px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: mono,
            fontSize: 10,
            letterSpacing: '0.06em',
            color: C.faint,
          }}
        >
          <span>
            {VERB_REGISTRY.map((v) => `${v.shortcut} ${v.label.toUpperCase()}`).join(' · ')}
          </span>
          <span>↑↓ FOCUS · ⏎ COMMIT · ⎋ ABORT · Z UNDO</span>
        </footer>
      )}
    </div>
  );
}
