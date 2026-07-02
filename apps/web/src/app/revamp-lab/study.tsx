'use client';
// revamp-lab · Direction 3 — THE STUDY
// Brief-led IA: the app opens as today's edition — a narrative lead whose
// sender names link into "The Docket" (decisions resolved inline, in reading
// flow), then "The Ledger" (what happened). Reading-room register: cream,
// Newsreader serif, terracotta. THROWAWAY.

import { useCallback, useEffect, useRef, useState } from 'react';
import { VERB_REGISTRY, verbById, type VerbId } from '@declutrmail/shared/actions';
import {
  PRIVACY_BADGE_HEADLINE,
  PRIVACY_NEVER_ITEMS,
  PRIVACY_STORAGE_ITEMS,
} from '@declutrmail/shared';
import {
  LAB_SENDERS,
  isTypingTarget,
  previewCopy,
  sessionTotals,
  type LabSender,
  type ResolvedAction,
} from './fixtures';

const C = {
  bg: '#FBF7EF',
  ink: '#211D16',
  soft: '#6B6357',
  rule: '#E4DCCB',
  terra: '#B4552D',
  sage: '#58705F',
  ochre: '#8F6A1F',
  oxide: '#9C2F21',
  wash: '#F5EFE2',
} as const;

const serif = 'var(--lab-newsreader), Georgia, serif';
const sans = 'var(--dm-font-sans), system-ui, sans-serif';
const mono = 'var(--dm-font-mono), monospace';

function verbColor(verb: VerbId): string {
  switch (verbById(verb).tone) {
    case 'amber':
      return C.ochre;
    case 'danger':
      return C.oxide;
    case 'dark':
      return C.ink;
    default:
      return verb === 'keep' ? C.sage : C.soft;
  }
}

const smallCaps: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 10,
  letterSpacing: '0.14em',
  color: C.soft,
};

export function StudyDirection({ mobile }: { mobile: boolean }) {
  const [docket, setDocket] = useState<LabSender[]>(LAB_SENDERS);
  const [ledger, setLedger] = useState<ResolvedAction[]>([]);
  const [openItem, setOpenItem] = useState<string | null>(null); // sender id with preview open
  const [pendingVerb, setPendingVerb] = useState<VerbId | null>(null);
  const [focusId, setFocusId] = useState<string | null>(LAB_SENDERS[0]?.id ?? null);
  const [note, setNote] = useState<string | null>(null);
  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const seqRef = useRef(0); // monotonic ledger key — length+1 collides after undo

  const focusSender = docket.find((s) => s.id === focusId) ?? docket[0];

  const resolve = useCallback((s: LabSender, verb: VerbId) => {
    // Dedupe inside the updater: same-tick ⏎ bursts share a stale closure,
    // so the guard must live where updates serialize. One entry per sender.
    setLedger((l) =>
      l.some((x) => x.sender.id === s.id) ? l : [...l, { sender: s, verb, at: ++seqRef.current }],
    );
    setDocket((d) => {
      const next = d.filter((x) => x.id !== s.id);
      setFocusId((cur) => {
        if (cur !== s.id) return cur;
        const idx = d.findIndex((x) => x.id === s.id);
        return next[Math.min(idx, next.length - 1)]?.id ?? null;
      });
      return next;
    });
    setOpenItem(null);
    setPendingVerb(null);
  }, []);

  const openPreview = useCallback(
    (senderId: string, verb: VerbId) => {
      const s = docket.find((x) => x.id === senderId);
      if (!s) return;
      if (verb === 'unsubscribe' && s.unsubChannel === null) {
        setNote(
          `${s.name} offers no unsubscribe channel — banks rarely do. Archive settles it just as well.`,
        );
        setTimeout(() => setNote(null), 4200);
        return;
      }
      if (!verbById(verb).destructive) {
        // Keep resolves directly (D226: preview gates destructive verbs)
        resolve(s, verb);
        return;
      }
      setOpenItem(senderId);
      setPendingVerb(verb);
    },
    [docket, resolve],
  );

  const undo = useCallback((entry: ResolvedAction) => {
    setLedger((l) => l.filter((x) => x.at !== entry.at));
    setDocket((d) => [entry.sender, ...d]);
    setFocusId(entry.sender.id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        setOpenItem(null);
        setPendingVerb(null);
        return;
      }
      if (k === 'enter' && openItem && pendingVerb) {
        const s = docket.find((x) => x.id === openItem);
        if (s) resolve(s, pendingVerb);
        return;
      }
      if (k === 'arrowdown' || k === 'arrowup') {
        e.preventDefault();
        const idx = docket.findIndex((x) => x.id === focusId);
        const next =
          docket[k === 'arrowdown' ? Math.min(idx + 1, docket.length - 1) : Math.max(idx - 1, 0)];
        if (next) {
          setFocusId(next.id);
          itemRefs.current[next.id]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (k === 'z') {
        const last = ledger[ledger.length - 1];
        if (last) undo(last);
        return;
      }
      const spec = VERB_REGISTRY.find((v) => v.shortcut.toLowerCase() === k);
      if (spec && focusSender) openPreview(focusSender.id, spec.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [docket, focusId, focusSender, ledger, openItem, openPreview, pendingVerb, resolve, undo]);

  const totals = sessionTotals(ledger);
  const quiet = docket.length === 0;

  // Narrative lead built from the docket (in the product this is the Brief engine)
  const leadSenders = docket.slice(0, 3);

  return (
    <div
      style={{
        minHeight: mobile ? undefined : '100dvh',
        height: mobile ? '100%' : undefined,
        overflowY: mobile ? 'auto' : undefined,
        background: C.bg,
        color: C.ink,
        fontFamily: sans,
        paddingBottom: 60,
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto', padding: mobile ? '0 20px' : '0 24px' }}>
        {/* Masthead */}
        <header style={{ textAlign: 'center', paddingTop: mobile ? 22 : 36 }}>
          <div style={smallCaps}>DECLUTRMAIL · THURSDAY, JULY 2</div>
          <h1
            style={{
              fontFamily: serif,
              fontWeight: 500,
              fontSize: mobile ? 34 : 44,
              letterSpacing: '-0.01em',
              margin: '10px 0 8px',
            }}
          >
            The Morning Edition
          </h1>
          <div style={{ ...smallCaps, color: C.sage }}>
            PRINTED FROM HEADERS ONLY — {PRIVACY_BADGE_HEADLINE.toUpperCase()}
          </div>
          <div
            aria-hidden
            style={{
              borderTop: `1px solid ${C.ink}`,
              borderBottom: `1px solid ${C.rule}`,
              height: 3,
              marginTop: 16,
            }}
          />
        </header>

        {/* Lead narrative — sender names are the navigation */}
        {!quiet && (
          <section style={{ marginTop: 26 }}>
            <p
              style={{
                fontFamily: serif,
                fontSize: mobile ? 18 : 20,
                lineHeight: 1.65,
                margin: 0,
              }}
            >
              {docket.length === 1 ? 'One sender waits' : `${docket.length} senders wait`} on a
              decision this morning.{' '}
              {leadSenders.map((s, i) => (
                <span key={s.id}>
                  <button
                    onClick={() => {
                      setFocusId(s.id);
                      itemRefs.current[s.id]?.scrollIntoView({
                        block: 'center',
                        behavior: 'smooth',
                      });
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      font: 'inherit',
                      color: C.terra,
                      textDecoration: 'underline',
                      textUnderlineOffset: 3,
                      cursor: 'pointer',
                    }}
                  >
                    {s.name}
                  </button>
                  {i === 0 &&
                    ` has gone quiet — ${s.lifetime.toLocaleString('en-US')} lifetime, read rate near zero. `}
                  {i === 1 && ` keeps a steady ${s.perMonth} a month. `}
                  {i === 2 && ` rounds out the docket. `}
                </span>
              ))}
              The rest follow below; each settles in one line, and{' '}
              <em style={{ fontFamily: serif }}>everything is reversible for seven days.</em>
            </p>
          </section>
        )}

        {/* The Docket */}
        {!quiet && (
          <section style={{ marginTop: 34 }}>
            <div
              style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}
            >
              <h2 style={{ ...smallCaps, fontSize: 11 }}>THE DOCKET — {docket.length}</h2>
              {!mobile && (
                <span style={smallCaps}>↑↓ MOVE · K A U L D ACT · ⏎ CONFIRM · Z UNDO</span>
              )}
            </div>
            <ol style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
              {docket.map((s) => {
                const focused = focusSender?.id === s.id;
                const previewOpen = openItem === s.id && pendingVerb;
                return (
                  <li
                    key={s.id}
                    ref={(el) => {
                      itemRefs.current[s.id] = el;
                    }}
                    onClick={() => setFocusId(s.id)}
                    style={{
                      borderTop: `1px solid ${C.rule}`,
                      padding: mobile ? '16px 0' : '16px 12px',
                      background: focused ? C.wash : 'transparent',
                      transition: 'background 160ms ease',
                      cursor: 'default',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: mobile ? 'wrap' : 'nowrap',
                        alignItems: 'baseline',
                        gap: mobile ? 6 : 14,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: serif,
                          fontSize: 19,
                          fontWeight: 500,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {s.name}
                        {s.protected && (
                          <span style={{ ...smallCaps, color: C.sage, marginLeft: 8 }}>
                            · PROTECTED
                          </span>
                        )}
                      </span>
                      <span
                        style={{
                          fontSize: 13.5,
                          color: C.soft,
                          flex: 1,
                          minWidth: mobile ? '100%' : 0,
                          lineHeight: 1.5,
                        }}
                      >
                        {s.reasoning}
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: mobile ? 10 : 14,
                        marginTop: 10,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span style={smallCaps}>
                        {s.perMonth}/MO · READ {Math.round(s.readRate * 100)}% ·{' '}
                        {verbById(s.recommended).label.toUpperCase()} {s.confidence}%
                      </span>
                      <span
                        style={{
                          display: 'flex',
                          gap: mobile ? 8 : 4,
                          marginLeft: 'auto',
                          flexWrap: 'wrap',
                        }}
                      >
                        {VERB_REGISTRY.map((v) => {
                          const disabled = v.id === 'unsubscribe' && s.unsubChannel === null;
                          const isRec = v.id === s.recommended;
                          return (
                            <button
                              key={v.id}
                              aria-disabled={disabled}
                              title={disabled ? 'No unsubscribe channel on this sender' : undefined}
                              onClick={(e) => {
                                e.stopPropagation();
                                setFocusId(s.id);
                                openPreview(s.id, v.id);
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                borderBottom: `1px ${isRec ? 'solid' : 'dotted'} ${
                                  disabled ? C.rule : verbColor(v.id)
                                }`,
                                color: disabled ? '#B8AF9E' : verbColor(v.id),
                                fontFamily: sans,
                                fontSize: 13,
                                fontWeight: isRec ? 700 : 500,
                                padding: '2px 2px 3px',
                                cursor: disabled ? 'not-allowed' : 'pointer',
                              }}
                            >
                              {v.label}
                              {!mobile && (
                                <span style={{ ...smallCaps, fontSize: 9, marginLeft: 4 }}>
                                  {v.shortcut}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </span>
                    </div>

                    {/* Inline preview line — italic serif, in reading flow (D226) */}
                    {previewOpen && pendingVerb && (
                      <div
                        role="dialog"
                        aria-label="Action preview"
                        style={{
                          marginTop: 12,
                          borderLeft: `2px solid ${verbColor(pendingVerb)}`,
                          paddingLeft: 14,
                        }}
                      >
                        {(() => {
                          const p = previewCopy(pendingVerb, s);
                          return (
                            <p
                              style={{
                                fontFamily: serif,
                                fontStyle: 'italic',
                                fontSize: 15.5,
                                lineHeight: 1.6,
                                margin: 0,
                                color: C.ink,
                              }}
                            >
                              {p.does} {p.doesNot} <span style={{ color: C.sage }}>{p.undo}</span>
                            </p>
                          );
                        })()}
                        <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                          <button
                            onClick={() => resolve(s, pendingVerb)}
                            style={{
                              background: C.ink,
                              color: C.bg,
                              border: 'none',
                              borderRadius: 3,
                              padding: '7px 16px',
                              fontFamily: sans,
                              fontSize: 13,
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Confirm{!mobile && ' ⏎'}
                          </button>
                          <button
                            onClick={() => {
                              setOpenItem(null);
                              setPendingVerb(null);
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: C.soft,
                              fontFamily: sans,
                              fontSize: 13,
                              cursor: 'pointer',
                              textDecoration: 'underline',
                              textUnderlineOffset: 3,
                            }}
                          >
                            Leave it
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            <div aria-hidden style={{ borderTop: `1px solid ${C.rule}` }} />
          </section>
        )}

        {note && (
          <p
            style={{
              fontFamily: serif,
              fontStyle: 'italic',
              color: C.ochre,
              fontSize: 14.5,
              marginTop: 14,
            }}
          >
            {note}
          </p>
        )}

        {/* Quiet study — done state + share */}
        {quiet && (
          <section style={{ textAlign: 'center', marginTop: 48 }}>
            <div aria-hidden style={{ fontSize: 22, color: C.terra }}>
              ❦
            </div>
            <h2
              style={{
                fontFamily: serif,
                fontStyle: 'italic',
                fontWeight: 500,
                fontSize: mobile ? 30 : 38,
                margin: '12px 0 10px',
              }}
            >
              The study is quiet.
            </h2>
            <p
              style={{
                fontSize: 15.5,
                color: C.soft,
                lineHeight: 1.6,
                maxWidth: 440,
                margin: '0 auto',
              }}
            >
              {totals.decided} decisions, one sitting. {totals.emails.toLocaleString('en-US')}{' '}
              messages settled, {totals.byVerb.unsubscribe} subscriptions ended. Nothing needs you
              until tomorrow&apos;s edition.
            </p>

            {/* Share clipping */}
            <div
              style={{
                margin: '30px auto 0',
                maxWidth: 400,
                background: '#FFFDF8',
                border: `1px solid ${C.ink}`,
                boxShadow: `4px 4px 0 ${C.rule}`,
                padding: '22px 26px',
                textAlign: 'center',
              }}
            >
              <div style={smallCaps}>DECLUTRMAIL — A READER&apos;S RECEIPT</div>
              <div
                style={{ fontFamily: serif, fontSize: 44, fontWeight: 500, margin: '10px 0 2px' }}
              >
                {totals.emails.toLocaleString('en-US')}
              </div>
              <div style={{ fontFamily: serif, fontStyle: 'italic', fontSize: 15, color: C.soft }}>
                messages settled before breakfast
              </div>
              <div aria-hidden style={{ borderTop: `1px solid ${C.rule}`, margin: '14px 0' }} />
              <div style={{ ...smallCaps, color: C.sage }}>
                {PRIVACY_BADGE_HEADLINE.toUpperCase()} · UNDO 7 DAYS
              </div>
            </div>
            <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 14 }}>
              <button
                onClick={() => {
                  setNote('Lab mock — the real clipping ships after the direction pick.');
                  setTimeout(() => setNote(null), 3200);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: C.terra,
                  textDecoration: 'underline',
                  textUnderlineOffset: 3,
                  fontSize: 13.5,
                  cursor: 'pointer',
                  fontFamily: sans,
                }}
              >
                Pass it along
              </button>
              <button
                onClick={() => {
                  setDocket(LAB_SENDERS);
                  setLedger([]);
                  setFocusId(LAB_SENDERS[0]?.id ?? null);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: C.soft,
                  textDecoration: 'underline',
                  textUnderlineOffset: 3,
                  fontSize: 13.5,
                  cursor: 'pointer',
                  fontFamily: sans,
                }}
              >
                Reset demo
              </button>
            </div>
          </section>
        )}

        {/* The Ledger */}
        {ledger.length > 0 && (
          <section style={{ marginTop: 36 }}>
            <h2 style={{ ...smallCaps, fontSize: 11 }}>THE LEDGER — TODAY</h2>
            <div style={{ marginTop: 8 }}>
              {[...ledger].reverse().map((r) => (
                <div
                  key={r.at}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 10,
                    borderTop: `1px dotted ${C.rule}`,
                    padding: '9px 0',
                    fontSize: 13.5,
                  }}
                >
                  <span style={{ ...smallCaps, color: verbColor(r.verb) }}>
                    {verbById(r.verb).label.toUpperCase()}
                  </span>
                  <span style={{ fontFamily: serif, fontSize: 15 }}>{r.sender.name}</span>
                  {r.verb !== 'keep' && (
                    <span style={{ color: C.soft }}>
                      {r.sender.lifetime.toLocaleString('en-US')} messages
                    </span>
                  )}
                  <button
                    onClick={() => undo(r)}
                    style={{
                      marginLeft: 'auto',
                      background: 'none',
                      border: 'none',
                      color: C.sage,
                      textDecoration: 'underline',
                      textUnderlineOffset: 3,
                      fontSize: 12.5,
                      cursor: 'pointer',
                      fontFamily: sans,
                    }}
                  >
                    undo
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Colophon — the trust block as furniture */}
        <footer style={{ marginTop: 56, borderTop: `1px solid ${C.ink}`, paddingTop: 14 }}>
          <div style={smallCaps}>COLOPHON — WHAT THIS EDITION IS PRINTED FROM</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: mobile ? '1fr' : '1fr 1fr',
              gap: mobile ? 10 : 24,
              marginTop: 10,
              fontSize: 12.5,
              lineHeight: 1.7,
              color: C.soft,
            }}
          >
            <div>
              <b style={{ color: C.ink }}>We store:</b> {PRIVACY_STORAGE_ITEMS.join(' · ')}
            </div>
            <div>
              <b style={{ color: C.ink }}>We never fetch or store:</b>{' '}
              {PRIVACY_NEVER_ITEMS.join(' · ')}
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
