'use client';

import { tokens } from '@declutrmail/shared';
import {
  UNSUBSCRIBE_ACCEPTED_CAVEAT,
  unsubscribeCapabilityBreakdown,
  unsubscribeOutcomeBreakdown,
  type UnsubscribeCapabilityCounts,
  type UnsubscribeOutcomeCounts,
} from '@declutrmail/shared/actions';

const { color, font } = tokens;

export interface UnsubBatchReceiptData {
  /** Senders the batch actually sent a one-click request for. */
  senderCount: number;
  /** How the whole selection split across the four capability states. */
  capabilities: UnsubscribeCapabilityCounts;
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
  // Everything the batch could not send, named per state.
  const excluded = unsubscribeCapabilityBreakdown({
    ...receipt.capabilities,
    one_click: 0,
  });
  const allFailed =
    receipt.outcomes !== null &&
    receipt.outcomes.endpointAccepted === 0 &&
    receipt.outcomes.unconfirmed === 0 &&
    receipt.outcomes.failed > 0;

  return (
    <div
      role={allFailed ? 'alert' : 'status'}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '10px 12px 10px 14px',
        background: allFailed ? color.redBg : color.emeraldBg,
        border: `1px solid ${allFailed ? color.redBorder : 'rgba(5,150,105,0.25)'}`,
        borderRadius: 10,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 22,
          height: 22,
          borderRadius: 9999,
          background: allFailed ? color.red : color.emerald,
          color: color.fgInverse,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontWeight: 700,
        }}
      >
        {allFailed ? '!' : '✓'}
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
