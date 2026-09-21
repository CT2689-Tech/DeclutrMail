'use client';

import { useEffect, type ReactNode } from 'react';
import { Button, PreviewSheet, SheetFact, tokens } from '@declutrmail/shared';
import { UNIFORM_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements/undo-window';

import { getActiveMailboxEmail, useOptionalAuth } from '@/features/auth/auth-provider';

import type { NoiseArchivePreview, NoiseTarget } from './api/use-noise-archive';

const { color, radius } = tokens;

/**
 * The D226-mandatory preview for the Brief's Noise bulk archive (D65).
 *
 * The shared `PreviewSheet`, in the Triage sheet's grammar: the live
 * count in the title, the scope in the subtitle, the undo in the note,
 * the per-sender breakdown behind "Details". Escape cancels, ⌘⏎
 * confirms, over the same aggregated preview endpoints.
 * Confirm stays disabled until a REAL server count has landed — a
 * cached or in-flight number never arms this button.
 *
 * The scope line is the load-bearing sentence on this surface. The
 * Noise heading above it counts YESTERDAY's mail (the frozen D69
 * snapshot); the archive reaches everything from these senders that is
 * in the inbox now. Those two numbers routinely differ, so the sheet
 * says which one is about to move, in the title.
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

  const auth = useOptionalAuth();
  const accountEmail = mailboxEmail ?? (auth ? getActiveMailboxEmail(auth.me) : null);

  // ⌘⏎ confirms, same as the Triage sheets. Escape belongs to the sheet.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !confirmDisabled) {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onConfirm, confirmDisabled]);

  if (!open) return null;

  const n = targets.length;
  const total = ready ? preview.totalMessages : null;
  // One sender reads by name, several by count — the Triage grammar.
  const from = n === 1 ? targets[0]!.senderName : `${n.toLocaleString('en-US')} senders`;
  const protectedCount = ready ? preview.protectedSenderIds.size : 0;

  const title = nothingToActOn
    ? n === 1
      ? `Nothing in your inbox from ${from}`
      : 'Nothing in your inbox from these senders'
    : total !== null
      ? `Archive ${total.toLocaleString('en-US')} email${total === 1 ? '' : 's'} from ${from}?`
      : `Archive email from ${from}?`;

  // Why confirm is unavailable, and the way out where one exists. A zero
  // count needs no line: the title already says nothing is there.
  const status: ReactNode =
    preview === 'loading' ? (
      'Counting the inbox…'
    ) : scopeConflict ? (
      'Your active mailbox changed while this was open, so these counts no longer apply. Close this and pick a mailbox to start again. Nothing was archived.'
    ) : preview === 'unavailable' ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        Couldn&rsquo;t load the preview. Nothing can move until it loads.
        <Button tone="default" size="sm" onClick={onRetryPreview}>
          Retry preview
        </Button>
      </span>
    ) : null;

  return (
    <PreviewSheet
      onClose={onCancel}
      testId="brief-noise-archive-sheet"
      icon={<ArchiveGlyph />}
      title={title}
      subtitle={
        nothingToActOn ? undefined : (
          <>
            This archives everything from {n === 1 ? 'this sender' : 'these senders'} that is in
            your inbox now — not only yesterday&rsquo;s mail. Nothing is deleted.
          </>
        )
      }
      note={
        confirmDisabled && !ready ? undefined : (
          <>
            {!confirmDisabled && (
              <span>
                {UNIFORM_UNDO_WINDOW_DAYS === null
                  ? "One undo reverses the whole batch during your plan's Activity window."
                  : `One undo reverses the whole batch during the ${UNIFORM_UNDO_WINDOW_DAYS}-day Activity window.`}
              </span>
            )}
            {/* The server can report a sender Protected that was not
                Protected when the Brief was read — said once, here. */}
            {protectedCount > 0 && (
              <>
                {' '}
                <span>
                  {protectedCount} sender{protectedCount === 1 ? '' : 's'} became Protected since
                  this Brief was written and {protectedCount === 1 ? 'is' : 'are'} excluded from the
                  total.
                </span>
              </>
            )}
          </>
        )
      }
      primary={{
        label: total !== null && total > 0 ? `Archive ${total.toLocaleString('en-US')}` : 'Archive',
        onClick: onConfirm,
        tone: 'primary',
        disabled: confirmDisabled,
      }}
      status={status ?? undefined}
      details={
        <>
          {accountEmail ? (
            <div role="note" aria-label={`Gmail account: ${accountEmail}`}>
              <SheetFact label="Gmail account">{accountEmail}</SheetFact>
            </div>
          ) : null}
          {ready && !nothingToActOn && <span>Counted now, rechecked when it runs.</span>}
          {/* Per-sender breakdown — the live figure beside the sender the
              user checked, so the total is verifiable row by row. */}
          <div
            role="list"
            aria-label="Current per-sender matches"
            style={{ display: 'flex', flexDirection: 'column' }}
          >
            {targets.map((target) => {
              const live =
                ready && target.senderId ? preview.countBySenderId.get(target.senderId) : undefined;
              // A sender that turned Protected is excluded from the total,
              // so labelling the row keeps the rows summing to it.
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
                    padding: '6px 0',
                    borderBottom: `1px solid ${color.lineSoft}`,
                  }}
                >
                  <span
                    style={{
                      color: color.fg,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                    }}
                  >
                    {target.senderName}
                  </span>
                  {skipped ? (
                    <span style={{ flexShrink: 0 }}>Protected — skipped</span>
                  ) : (
                    <span
                      style={{
                        flexShrink: 0,
                        fontWeight: 600,
                        color: color.fg,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {live === undefined ? '—' : live.toLocaleString('en-US')}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      }
    />
  );
}

function ArchiveGlyph() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 64,
        height: 64,
        borderRadius: radius.pill,
        background: color.primarySoft,
        color: color.primary,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="4" width="18" height="5" rx="1.5" />
        <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
        <path d="M10 13h4" />
      </svg>
    </span>
  );
}
