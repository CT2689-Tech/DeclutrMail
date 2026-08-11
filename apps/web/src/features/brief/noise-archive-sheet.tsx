'use client';

import { useEffect } from 'react';
import { Button, Eyebrow, Kbd, tokens, useFocusTrap } from '@declutrmail/shared';

import { MailboxActionContext } from '@/features/auth/mailbox-action-context';

import type { NoiseArchivePreview, NoiseTarget } from './api/use-noise-archive';

const { color, font } = tokens;

/**
 * The D226-mandatory preview for the Brief's Noise bulk archive (D65).
 *
 * Same chrome and keyboard contract as the Triage batch sheet (Escape
 * cancels, ⌘⏎ confirms) over the same aggregated preview endpoints.
 * Confirm stays disabled until a REAL server count has landed — a
 * cached or in-flight number never arms this button.
 *
 * The scope line is the load-bearing sentence on this surface. The
 * Noise heading above it counts YESTERDAY's mail (the frozen D69
 * snapshot); the archive reaches everything from these senders that is
 * in the inbox now. Those two numbers routinely differ, so the sheet
 * says which one is about to move, in the largest type on screen.
 */
export function NoiseArchiveSheet({
  open,
  targets,
  preview,
  mailboxEmail,
  onCancel,
  onConfirm,
  onRetryPreview,
}: {
  open: boolean;
  /** The exact senders this confirmation covers, frozen at open. */
  targets: readonly NoiseTarget[];
  preview: NoiseArchivePreview;
  /** Explicit override for isolated previews; app surfaces use active auth context. */
  mailboxEmail?: string | undefined;
  onCancel: () => void;
  onConfirm: () => void;
  onRetryPreview: () => void;
}) {
  const ready = typeof preview === 'object';
  // Archive's ENTIRE effect is moving inbox mail, so a zero live count
  // makes confirm a pure no-op that would still enqueue a job, write an
  // Activity row and spend a cleanup unit. Gated on the SAME number the
  // headline renders, so "0 emails currently match" can never sit above
  // an enabled confirm. `confirm()` re-checks this itself — this is the
  // affordance, not the rule.
  const nothingToActOn = ready && preview.totalMessages === 0;
  const confirmDisabled = !ready || nothingToActOn || targets.length === 0;
  // A scope 409 is not a failed read to retry — retrying 409s forever.
  const scopeConflict = preview === 'scope-conflict';

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !confirmDisabled) {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel, onConfirm, confirmDisabled]);

  const trapRef = useFocusTrap<HTMLDivElement>(open);

  if (!open) return null;

  const n = targets.length;
  const total = ready ? preview.totalMessages : null;

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
        aria-labelledby="dm-brief-noise-sheet-title"
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
        <div style={{ padding: '20px 24px 12px', borderBottom: `1px solid ${color.line}` }}>
          <Eyebrow tone="primary">Preview · before anything changes</Eyebrow>
          <h2
            id="dm-brief-noise-sheet-title"
            style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.014em', margin: '6px 0 0' }}
          >
            Archive mail from {n} sender{n === 1 ? '' : 's'}
          </h2>
          <p style={{ fontSize: 13, color: color.fgSoft, margin: '8px 0 0', lineHeight: 1.5 }}>
            This archives everything from these senders that is in your inbox now — not only
            yesterday&rsquo;s mail. Nothing is deleted, and one undo reverses the whole batch.
          </p>
        </div>

        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <MailboxActionContext mailboxEmail={mailboxEmail} />

          {/* The live count. All three states render (D211), and only the
              ready state can arm the confirm below. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              flexWrap: 'wrap',
              padding: '12px 14px',
              background: color.paper,
              border: `1px solid ${color.line}`,
              borderRadius: 9,
            }}
          >
            {preview === 'loading' ? (
              <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                Counting the inbox… Confirm unlocks when it is ready.
              </span>
            ) : scopeConflict ? (
              <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                Your active mailbox changed while this was open, so these counts no longer apply.
                Close this and pick a mailbox to start again. Nothing was archived.
              </span>
            ) : preview === 'unavailable' ? (
              <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                Couldn&rsquo;t load a live preview. Retry — no inbox mail can move without one.
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
                  {total!.toLocaleString()}
                </strong>
                <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                  email{total === 1 ? '' : 's'} currently match in Inbox. Gmail is checked again at
                  execution, so the final moved count can change.
                </span>
              </>
            )}
          </div>

          {/* Per-sender breakdown — the live figure beside the sender the
              user checked, so the total above is verifiable row by row. */}
          <div
            role="list"
            aria-label="Current per-sender matches"
            style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
          >
            {targets.map((target) => {
              const live =
                ready && target.senderId ? preview.countBySenderId.get(target.senderId) : undefined;
              // The server can report a sender Protected that was not
              // Protected when the Brief was read. Its mail is excluded
              // from the headline, so labelling the row is what keeps the
              // visible rows summing to the total above them.
              const skipped =
                ready && target.senderId ? preview.protectedSenderIds.has(target.senderId) : false;
              return (
                <div
                  key={target.senderKey}
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
                    {target.senderName}
                  </span>
                  <span
                    style={{
                      fontFamily: font.mono,
                      fontVariantNumeric: 'tabular-nums',
                      flexShrink: 0,
                    }}
                  >
                    {skipped
                      ? 'protected — skipped'
                      : live === undefined
                        ? '—'
                        : live.toLocaleString()}
                  </span>
                </div>
              );
            })}
            {ready && preview.protectedSenderIds.size > 0 && (
              <span style={{ fontSize: 11.5, color: color.fgMuted, marginTop: 2 }}>
                {preview.protectedSenderIds.size} sender
                {preview.protectedSenderIds.size === 1 ? '' : 's'} became Protected since this Brief
                was written and {preview.protectedSenderIds.size === 1 ? 'is' : 'are'} excluded from
                the total above.
              </span>
            )}
          </div>
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
            {confirmDisabled
              ? scopeConflict
                ? 'Mailbox changed — close this and start again.'
                : preview === 'unavailable'
                  ? 'Preview unavailable — retry before confirming.'
                  : nothingToActOn
                    ? 'Nothing from these senders is in your inbox — there is nothing to archive.'
                    : 'Counting inbox mail — confirm unlocks after the live preview loads.'
              : "One undo reverses the whole batch during your plan's Activity window."}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {preview === 'unavailable' && (
              <Button tone="default" onClick={onRetryPreview}>
                Retry preview
              </Button>
            )}
            <Button tone="default" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              tone="primary"
              disabled={confirmDisabled}
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
              Archive
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
