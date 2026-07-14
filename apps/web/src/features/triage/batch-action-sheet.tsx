'use client';

import { useEffect } from 'react';
import { Button, Eyebrow, Kbd, tokens, useFocusTrap } from '@declutrmail/shared';
import { buildActionPresentation } from '@declutrmail/shared/actions';
import { getActionFailureCopy } from '@/lib/action-error-copy';
import type { BulkActionPreviewResult } from '@/lib/api/use-action';

import type { DomainBatch } from './domain-batch';
import type { BatchVerb } from './domain-batch-card';

const { color, font } = tokens;

/**
 * Batch action sheet — the D226-mandatory preview for a domain-batch
 * decision. Mirrors `<ActionSheet>`'s chrome and keyboard contract
 * (Escape cancels, ⌘⏎ confirms) over the AGGREGATED bulk preview
 * (`POST /api/actions/preview/bulk`): the total that will actually
 * move, the per-sender breakdown, and the protected senders the
 * enqueue will skip. The confirm fires ONE composite `POST
 * /api/actions` with the senders selector (ADR-0020) — one batch,
 * one cascade undo token.
 *
 * No remember-preference toggle here: D34's skip-sheet path is a
 * per-verb single-row ergonomic; a multi-sender batch always shows
 * its sheet.
 */
export function BatchActionSheet({
  open,
  verb,
  batch,
  preview,
  wakeAt = null,
  onCancel,
  onConfirm,
  onRetryPreview,
}: {
  open: boolean;
  verb: BatchVerb;
  batch: DomainBatch | null;
  /** Aggregated preview — `null` while loading, `'unavailable'` on failure. */
  preview: BulkActionPreviewResult | 'loading' | 'unavailable';
  /** Exact Later return time carried through confirmation. */
  wakeAt?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  onRetryPreview?: (() => void) | undefined;
}) {
  const previewReady = typeof preview === 'object';
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && previewReady) {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, previewReady, onCancel, onConfirm]);

  const trapRef = useFocusTrap<HTMLDivElement>(open);

  if (!open || !batch) return null;

  const eligible = batch.rows.filter((r) => r.protectionReason === null);
  const presentation = buildActionPresentation({
    verb: verb === 'Archive' ? 'archive' : 'later',
    liveCount: typeof preview === 'object' ? preview.totals.all : null,
    planUndoDeadline: null,
    wakeAt: verb === 'Later' ? wakeAt : null,
    unsubscribeChannel: null,
  });
  const title =
    verb === 'Archive'
      ? `Archive all inbox mail from ${eligible.length} senders`
      : `Move ${eligible.length} senders to Later`;
  const lead = presentation.previewCopy;

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
        aria-labelledby="dm-triage-batch-sheet-title"
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
        <div style={{ padding: '20px 24px 8px', borderBottom: `1px solid ${color.line}` }}>
          <Eyebrow tone="primary">Preview · {verb} · multiple senders</Eyebrow>
          <h2
            id="dm-triage-batch-sheet-title"
            style={{
              fontSize: 19,
              fontWeight: 600,
              letterSpacing: '-0.014em',
              margin: '6px 0 12px',
            }}
          >
            {batch.domain}
          </h2>
        </div>

        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div role="region" aria-label={`Preview · ${verb} ${batch.domain} batch`}>
            <h3 style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.012em', margin: 0 }}>
              {title}
            </h3>
            <p style={{ fontSize: 12.5, color: color.fgSoft, margin: '4px 0 0', lineHeight: 1.5 }}>
              {lead}
            </p>
          </div>

          {/* Impact figure — the REAL aggregated count (D226), never a
              client estimate. All four states rendered (D211). */}
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              padding: '10px 12px',
              background: color.paper,
              border: `1px solid ${color.line}`,
              borderRadius: 8,
            }}
          >
            {preview === 'loading' ? (
              <span style={{ fontSize: 12, color: color.fgSoft }}>Counting the inbox…</span>
            ) : preview === 'unavailable' ? (
              <span style={{ fontSize: 12, color: color.fgSoft }}>
                {getActionFailureCopy('preview').message}
              </span>
            ) : (
              <>
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
                  {preview.totals.all.toLocaleString()}
                </strong>
                <span style={{ fontSize: 12, color: color.fgSoft }}>
                  email{preview.totals.all === 1 ? '' : 's'} now in the inbox
                  {preview.totals.all === 0
                    ? ' — nothing to move.'
                    : ' will move out of the inbox.'}
                </span>
              </>
            )}
          </div>

          {/* Per-sender breakdown from the live preview. */}
          {typeof preview === 'object' && (
            <div
              role="list"
              aria-label="Per-sender impact"
              style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
            >
              {preview.senders.map((s) => (
                <div
                  key={s.senderId}
                  role="listitem"
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 12,
                    fontSize: 12,
                    color: color.fgSoft,
                    padding: '4px 2px',
                    borderBottom: `1px solid ${color.lineSoft}`,
                  }}
                >
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                    }}
                  >
                    {s.name}
                  </span>
                  <span
                    style={{
                      fontFamily: font.mono,
                      fontVariantNumeric: 'tabular-nums',
                      flexShrink: 0,
                    }}
                  >
                    {s.protected ? 'protected — skipped' : `${s.counts.all.toLocaleString()}`}
                  </span>
                </div>
              ))}
              {preview.protectedCount > 0 && (
                <span style={{ fontSize: 11.5, color: color.fgMuted, marginTop: 2 }}>
                  {preview.protectedCount} protected sender
                  {preview.protectedCount === 1 ? '' : 's'} will be skipped.
                </span>
              )}
            </div>
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
            {presentation.primary.activityUndo.summary}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {preview === 'unavailable' && onRetryPreview && (
              <Button tone="default" onClick={onRetryPreview}>
                Retry preview
              </Button>
            )}
            <Button tone="default" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              tone="primary"
              disabled={!previewReady}
              onClick={onConfirm}
              iconRight={
                <Kbd
                  style={{
                    background: color.lineInverse,
                    border: 'none',
                    color: color.fgInverse,
                  }}
                >
                  ⌘⏎
                </Kbd>
              }
            >
              {verb === 'Archive' ? 'Archive all' : 'Later for all'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
