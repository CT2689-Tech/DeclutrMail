'use client';

import { useEffect, useState } from 'react';
import { Button, Eyebrow, Kbd, tokens } from '@declutrmail/shared';
import { historicCount, type ActionRequest } from './data';

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
  const [archiveHistoric, setArchiveHistoric] = useState(true);

  useEffect(() => {
    setArchiveHistoric(true);
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

  if (!request) return null;

  const { verb, senders } = request;
  const historic = senders.reduce((sum, s) => sum + historicCount(s), 0);
  const isUnsub = verb === 'Unsubscribe';

  const title =
    verb === 'Archive'
      ? `Archive all mail from ${senders.length} sender${senders.length === 1 ? '' : 's'}`
      : `Unsubscribe from ${senders.length} sender${senders.length === 1 ? '' : 's'}`;
  const lead = isUnsub
    ? 'Future mail from these senders stops arriving. Nothing already in your inbox moves unless you ask.'
    : `Every message from ${senders.length === 1 ? 'this sender' : 'these senders'} moves out of the inbox into Gmail's archive. Nothing is deleted.`;

  return (
    <>
      <div
        onClick={onCancel}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(20,20,20,0.45)',
          backdropFilter: 'blur(3px)',
          zIndex: 150,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
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
          boxShadow: '0 24px 60px rgba(0,0,0,0.30)',
          zIndex: 151,
          fontFamily: font.sans,
        }}
      >
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${color.line}` }}>
          <Eyebrow tone={isUnsub ? 'amber' : 'primary'}>Preview · before anything changes</Eyebrow>
          <h2
            style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.014em', margin: '6px 0 0' }}
          >
            {title}
          </h2>
          <p style={{ fontSize: 13, color: color.fgSoft, margin: '6px 0 0', lineHeight: 1.5 }}>
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
                fontFamily: font.sans,
                fontSize: 22,
                fontWeight: 700,
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

          {isUnsub && (
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
            <Button tone="default" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              tone={isUnsub ? 'warn' : 'primary'}
              onClick={() => onConfirm({ archiveHistoric })}
              iconRight={
                <Kbd
                  style={{ background: 'rgba(255,255,255,0.16)', border: 'none', color: '#FFFFFF' }}
                >
                  ⌘⏎
                </Kbd>
              }
            >
              {verb}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
