'use client';

import { tokens } from '@declutrmail/shared';
import { getActionSemantics, type ActionReceiptResult } from '@declutrmail/shared/actions';

const { color, font } = tokens;

/** Product-wide D245 result contract plus sender scope for this surface. */
export type ActionReceipt = ActionReceiptResult & { senderCount: number };

/**
 * Persistent action result. Unlike the old strip, it does not assume every
 * result succeeded or can be undone: partial, no-op, failed, expired, wake,
 * Activity Undo, and Gmail recovery states all render from one shared model.
 */
export function ReceiptStrip({
  receipt,
  onUndo,
  onDismiss,
}: {
  receipt: ActionReceipt | null;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  if (!receipt) return null;

  const semantics = getActionSemantics(receipt.verb);
  const undo = receipt.activityUndo;
  const canUndo = undo.state === 'available' || undo.state === 'unknown';
  const countCopy = receiptCountCopy(receipt);
  const statusCopy = receiptStatusCopy(receipt);
  const wakeCopy =
    receipt.wake.kind === 'scheduled'
      ? `Returns to Inbox ${formatDateTime(receipt.wake.at)}.`
      : null;
  const providerCopy =
    receipt.providerRecovery.kind === 'gmail-trash' ? receipt.providerRecovery.summary : null;

  return (
    <div
      role={receipt.state === 'failed' ? 'alert' : 'status'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px 10px 14px',
        background: receipt.state === 'failed' ? color.redBg : color.emeraldBg,
        border: `1px solid ${receipt.state === 'failed' ? color.redBorder : 'rgba(5,150,105,0.25)'}`,
        borderRadius: 10,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 22,
          height: 22,
          borderRadius: 9999,
          background: receipt.state === 'failed' ? color.red : color.emerald,
          color: color.fgInverse,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontWeight: 700,
        }}
      >
        {receipt.state === 'failed' ? '!' : '✓'}
      </span>

      <span style={{ flex: 1, fontSize: 13, color: color.fg, lineHeight: 1.45 }}>
        <strong style={{ fontWeight: 600 }}>
          {receipt.state === 'failed' ? `${semantics.label} failed` : semantics.resultLabel}
        </strong>{' '}
        <span style={{ color: color.fgSoft }}>{countCopy}</span>
        <span
          style={{
            marginLeft: 8,
            fontFamily: font.mono,
            fontSize: 10.5,
            color: color.fgMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {statusCopy}
        </span>
        {(wakeCopy || providerCopy) && (
          <span style={{ display: 'block', color: color.fgMuted, fontSize: 11.5, marginTop: 2 }}>
            {[wakeCopy, providerCopy].filter(Boolean).join(' ')}
          </span>
        )}
      </span>

      {canUndo && (
        <button
          onClick={onUndo}
          style={{
            background: color.card,
            border: `1px solid ${color.emerald}`,
            color: color.emerald,
            borderRadius: 6,
            padding: '4px 12px',
            fontFamily: font.sans,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Undo
        </button>
      )}
      <button
        onClick={onDismiss}
        aria-label={`Dismiss ${semantics.label} result`}
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

function receiptCountCopy(receipt: ActionReceipt): string {
  const senderCopy = `${receipt.senderCount} sender${receipt.senderCount === 1 ? '' : 's'}`;
  if (receipt.outcome === 'no-op') return `· No matching inbox mail moved · ${senderCopy}`;
  if (receipt.outcome === 'partial') {
    return `· ${receipt.affectedCount.toLocaleString()} of ${receipt.requestedCount.toLocaleString()} emails changed · ${senderCopy}`;
  }
  if (receipt.affectedCount > 0) {
    return `· ${receipt.affectedCount.toLocaleString()} email${receipt.affectedCount === 1 ? '' : 's'} · ${senderCopy}`;
  }
  return `· ${senderCopy}`;
}

function receiptStatusCopy(receipt: ActionReceipt): string {
  if (receipt.state === 'pending') return 'Confirming';
  if (receipt.state === 'failed') return 'Nothing else will be retried automatically';
  switch (receipt.activityUndo.state) {
    case 'available':
      return `Activity Undo until ${formatDateTime(receipt.activityUndo.deadline)}`;
    case 'expired':
      return 'Activity Undo expired';
    case 'reverting':
      return 'Undo in progress';
    case 'revert-failed':
      return 'Undo failed · Try Activity';
    case 'reverted':
      return 'Undone';
    case 'not-applicable':
      return 'Final after delivery';
    case 'pending':
      return 'Undo details pending';
    case 'unknown':
      return 'Activity Undo available';
    case 'unavailable':
      return 'No Activity Undo available';
  }
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));
}
