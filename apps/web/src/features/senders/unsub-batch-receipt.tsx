'use client';

import { tokens } from '@declutrmail/shared';
import {
  UNSUBSCRIBE_ACCEPTED_CAVEAT,
  unsubscribeCapabilityBreakdown,
  unsubscribeOutcomeBreakdown,
  type UnsubscribeOutcomeCounts,
} from '@declutrmail/shared/actions';
import type { BulkSkipReason } from '@/lib/api/actions';

const { color, font } = tokens;

export interface UnsubBatchReceiptData {
  /** Senders the batch actually sent a one-click request for. */
  senderCount: number;
  /**
   * The server's own skip list, verbatim — the partition the batch
   * ACTUALLY used, not the client's cached view of the selection.
   * Deriving this from local rows dropped server-side `protected` and
   * `not_found` skips entirely and let a stale list report a split the
   * server never used: the list/detail-drift shape of the very defect
   * class this decision exists to close.
   */
  skipped: ReadonlyArray<{ reason: BulkSkipReason }>;
  /**
   * Terminal outcomes observed for this batch, or `null` while the
   * requests are still in flight. Never derived from a job-status
   * tally — an unconfirmed request is job-status `failed`.
   */
  outcomes: UnsubscribeOutcomeCounts | null;
  /** Requests still queued or executing. */
  pending: number;
}

/**
 * "Not sent" lines, one per reason the SERVER reported. The three
 * capability reasons reuse the shared breakdown copy so the receipt and
 * the preview cannot word the same fact differently.
 */
function skippedLines(skipped: UnsubBatchReceiptData['skipped']): string[] {
  const count = (reason: BulkSkipReason): number =>
    skipped.filter((entry) => entry.reason === reason).length;
  const capability = unsubscribeCapabilityBreakdown({
    one_click: 0,
    mailto: count('mailto'),
    none: count('no_channel'),
    unknown: count('unknown'),
  });
  const senders = (n: number): string => `${n} sender${n === 1 ? '' : 's'}`;
  const protectedCount = count('protected');
  const missingCount = count('not_found');
  return [
    ...capability,
    ...(protectedCount > 0 ? [`${senders(protectedCount)} protected`] : []),
    ...(missingCount > 0 ? [`${senders(missingCount)} no longer in your list`] : []),
  ];
}

/**
 * Result of a multi-sender unsubscribe (D248).
 *
 * Two things it deliberately does NOT do. It never says "unsubscribed":
 * a 2xx proves the sender's endpoint took the request, not that the
 * mail stops. And it never folds "unconfirmed" into accepted or failed —
 * the request went out and we could not establish what happened, which
 * is its own fact.
 *
 * There is no Undo: a delivered unsubscribe cannot be recalled (D58).
 * The confirm preview was the reversal point.
 */
export function UnsubBatchReceipt({
  receipt,
  onDismiss,
}: {
  receipt: UnsubBatchReceiptData | null;
  onDismiss: () => void;
}) {
  if (!receipt) return null;

  // Requests are still going out. `unreported` is the deploy-skew case:
  // the batch finished but this API build sends no outcome breakdown, so
  // the receipt points at Activity rather than inventing a split.
  const inFlight = receipt.outcomes === null && receipt.pending > 0;
  const unreported = receipt.outcomes === null && receipt.pending === 0;
  const outcomeLines = receipt.outcomes ? unsubscribeOutcomeBreakdown(receipt.outcomes) : [];
  // Everything the batch could not send, named per reason the server gave.
  const excluded = skippedLines(receipt.skipped);
  const allFailed =
    receipt.outcomes !== null &&
    receipt.outcomes.endpointAccepted === 0 &&
    receipt.outcomes.unconfirmed === 0 &&
    receipt.outcomes.failed > 0;
  // Nothing accepted and nothing failed — every request is unconfirmed.
  // Success chrome (green tick, emerald) would round that toward
  // "accepted" in exactly the way the copy refuses to, so the surface
  // stays neutral: D248 puts `unconfirmed` on equal footing with its
  // neighbours, and the frame is part of the claim.
  const allUnconfirmed =
    receipt.outcomes !== null &&
    receipt.outcomes.endpointAccepted === 0 &&
    receipt.outcomes.failed === 0 &&
    receipt.outcomes.unconfirmed > 0;
  const tone: 'failed' | 'neutral' | 'positive' = allFailed
    ? 'failed'
    : allUnconfirmed || inFlight || unreported
      ? 'neutral'
      : 'positive';
  const frame = {
    failed: { bg: color.redBg, border: color.redBorder, badge: color.red, glyph: '!' },
    neutral: { bg: color.card, border: color.line, badge: color.fgMuted, glyph: '·' },
    positive: {
      bg: color.emeraldBg,
      border: 'rgba(5,150,105,0.25)',
      badge: color.emerald,
      glyph: '✓',
    },
  }[tone];

  return (
    <div
      role={allFailed ? 'alert' : 'status'}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '10px 12px 10px 14px',
        background: frame.bg,
        border: `1px solid ${frame.border}`,
        borderRadius: 10,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 22,
          height: 22,
          borderRadius: 9999,
          background: frame.badge,
          color: color.fgInverse,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontWeight: 700,
        }}
      >
        {frame.glyph}
      </span>

      <span style={{ flex: 1, fontSize: 13, color: color.fg, lineHeight: 1.45 }}>
        <strong style={{ fontWeight: 600 }}>
          {inFlight ? 'Sending unsubscribe requests' : 'Unsubscribe requests sent'}
        </strong>{' '}
        <span style={{ color: color.fgSoft }}>
          ·{' '}
          {receipt.senderCount === 1
            ? '1 sender'
            : `${receipt.senderCount.toLocaleString()} senders`}
        </span>
        <span
          style={{
            display: 'block',
            marginTop: 3,
            fontFamily: font.mono,
            fontSize: 11,
            color: color.fgMuted,
            letterSpacing: '0.02em',
          }}
        >
          {inFlight
            ? `${receipt.pending} still going out`
            : unreported
              ? 'See Activity for each result.'
              : [
                  ...outcomeLines,
                  ...(receipt.pending > 0 ? [`${receipt.pending} still going out`] : []),
                ].join(' · ')}
        </span>
        {excluded.length > 0 && (
          <span
            style={{
              display: 'block',
              marginTop: 2,
              fontFamily: font.mono,
              fontSize: 11,
              color: color.fgMuted,
              letterSpacing: '0.02em',
            }}
          >
            Not sent: {excluded.join(' · ')}
          </span>
        )}
        {!inFlight && !unreported && (
          <span style={{ display: 'block', color: color.fgMuted, fontSize: 11.5, marginTop: 3 }}>
            {UNSUBSCRIBE_ACCEPTED_CAVEAT}
          </span>
        )}
      </span>

      <button
        onClick={onDismiss}
        aria-label="Dismiss unsubscribe result"
        style={{
          background: 'transparent',
          border: 'none',
          color: color.fgMuted,
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          padding: '0 4px',
        }}
      >
        ×
      </button>
    </div>
  );
}
