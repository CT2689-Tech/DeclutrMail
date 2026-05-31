'use client';

import { useEffect, useState } from 'react';
import { Button, Eyebrow, Kbd, tokens, useFocusTrap } from '@declutrmail/shared';
import { historicCount, verbDisplay, type ActionRequest } from './data';

const { color, font } = tokens;

export interface ConfirmOptions {
  archiveHistoric: boolean;
}

/**
 * The mandatory action preview (D226). No bulk mutation runs without
 * this confirm — it states exactly what changes and how much mail it
 * touches before anything happens.
 */
export function ConfirmActionModal({
  request,
  onCancel,
  onConfirm,
}: {
  request: ActionRequest | null;
  onCancel: () => void;
  onConfirm: (opts: ConfirmOptions) => void;
}) {
  // Unsubscribe defaults to also clearing the backlog (the common
  // intent when cutting a sender off). Later defaults OFF — Later is
  // future-only by definition; archiving history would make it
  // destructive against the modal's own copy.
  const [archiveHistoric, setArchiveHistoric] = useState(false);

  useEffect(() => {
    setArchiveHistoric(request?.verb === 'Unsubscribe');
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onConfirm({ archiveHistoric });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, archiveHistoric, onCancel, onConfirm]);

  const trapRef = useFocusTrap<HTMLDivElement>(request !== null);

  if (!request) return null;

  const { verb, senders } = request;
  const historic = senders.reduce((sum, s) => sum + historicCount(s), 0);
  const n = senders.length;
  const plural = n === 1 ? '' : 's';
  const subject = n === 1 ? 'this sender' : 'these senders';
  // Unsubscribe and Later touch only future mail by default, so both
  // offer the "also clear the historic backlog" toggle. Archive moves
  // every message by definition. Only Unsubscribe reads as destructive.
  const showHistoricToggle = verb === 'Unsubscribe' || verb === 'Later';
  const danger = verb === 'Unsubscribe';

  const title =
    verb === 'Archive'
      ? `Archive all mail from ${n} sender${plural}`
      : verb === 'Later'
        ? `Move ${n} sender${plural} to Later`
        : `Unsubscribe from ${n} sender${plural}`;
  const lead =
    verb === 'Archive'
      ? `Every message from ${subject} moves out of the inbox into Gmail's archive. Nothing is deleted.`
      : verb === 'Later'
        ? `Future mail from ${subject} skips the inbox and lands in a DeclutrMail/Later label. Nothing is unsubscribed or deleted.`
        : `Future mail from ${subject} stops arriving. Nothing already in your inbox moves unless you ask.`;

  return (
    <>
      <div
        onClick={onCancel}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(14,20,19,0.45)',
          backdropFilter: 'blur(3px)',
          zIndex: 150,
        }}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dm-confirm-title"
        aria-describedby="dm-confirm-lead"
        style={{
          position: 'fixed',
          top: '12vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(540px, calc(100vw - 32px))',
          maxHeight: '76vh',
          overflow: 'auto',
          background: color.card,
          borderRadius: 14,
          border: `1px solid ${color.border}`,
          boxShadow: '0 24px 60px rgba(14,20,19,0.30)',
          zIndex: 151,
          fontFamily: font.sans,
        }}
      >
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${color.line}` }}>
          <Eyebrow tone={danger ? 'amber' : 'primary'}>Preview · before anything changes</Eyebrow>
          <h2
            id="dm-confirm-title"
            style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.014em', margin: '6px 0 0' }}
          >
            {title}
          </h2>
          <p
            id="dm-confirm-lead"
            style={{ fontSize: 13, color: color.fgSoft, margin: '6px 0 0', lineHeight: 1.5 }}
          >
            {lead}
          </p>
        </div>

        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Affected senders preview */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
            }}
          >
            {senders.slice(0, 6).map((s) => (
              <span
                key={s.id}
                style={{
                  fontFamily: font.mono,
                  fontSize: 11,
                  color: color.fgSoft,
                  background: color.paper,
                  border: `1px solid ${color.line}`,
                  borderRadius: 6,
                  padding: '3px 8px',
                }}
              >
                {s.name}
              </span>
            ))}
            {senders.length > 6 && (
              <span
                style={{
                  fontFamily: font.mono,
                  fontSize: 11,
                  color: color.fgMuted,
                  alignSelf: 'center',
                }}
              >
                +{senders.length - 6} more
              </span>
            )}
          </div>

          {/* Impact figure */}
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              padding: '12px 14px',
              background: color.paper,
              border: `1px solid ${color.line}`,
              borderRadius: 9,
            }}
          >
            <strong
              style={{
                fontFamily: font.display,
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: '-0.02em',
                color: color.fg,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {historic.toLocaleString()}
            </strong>
            <span style={{ fontSize: 12.5, color: color.fgSoft }}>
              historic email{historic === 1 ? '' : 's'} from{' '}
              {senders.length === 1 ? 'this sender' : 'these senders'} sit in your mailbox today.
            </span>
          </div>

          {showHistoricToggle && (
            <button
              onClick={() => setArchiveHistoric((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                background: archiveHistoric ? color.primarySoft : 'transparent',
                border: `1px solid ${archiveHistoric ? color.primaryBorder : color.line}`,
                borderRadius: 9,
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: font.sans,
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  border: `1.5px solid ${archiveHistoric ? color.primary : 'rgba(14,20,19,0.28)'}`,
                  background: archiveHistoric ? color.primary : color.card,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {archiveHistoric && (
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </span>
              <span style={{ fontSize: 12.5, color: color.fg }}>
                Also archive the {historic.toLocaleString()} historic email
                {historic === 1 ? '' : 's'} already in the inbox
              </span>
            </button>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 24px 18px',
            borderTop: `1px solid ${color.line}`,
          }}
        >
          <span style={{ fontSize: 11.5, color: color.fgMuted }}>
            Reversible for 7 days from Activity.
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              tone="default"
              onClick={onCancel}
              // Subtle secondary hint — the key this modal actually cancels
              // on is Escape (see the keydown handler above), so the chip
              // reads `Esc`, not the looser `⌫` notation from the brief.
              iconRight={<Kbd style={{ fontSize: 9, color: color.fgMuted }}>Esc</Kbd>}
            >
              Cancel
            </Button>
            <Button
              tone={danger ? 'warn' : 'primary'}
              onClick={() => onConfirm({ archiveHistoric })}
              iconRight={
                <Kbd
                  style={{ background: 'rgba(255,255,255,0.16)', border: 'none', color: '#FFFFFF' }}
                >
                  ⌘⏎
                </Kbd>
              }
            >
              {/* Confirm label = the verb's registry copy (ADR-0015). */}
              {verbDisplay(verb).label}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
