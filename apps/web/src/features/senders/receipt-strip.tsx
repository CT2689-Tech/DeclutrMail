'use client';

import { tokens } from '@declutrmail/shared';
import { VERB_PAST, type ActionVerb } from './data';

const { color, font } = tokens;

export interface ActionReceipt {
  id: string;
  verb: ActionVerb;
  count: number;
  historicTotal: number;
  timeLeft: string;
  /**
   * Real undo token from a completed action (D226). Present for the
   * server-wired Archive path; null/undefined for tracer receipts whose
   * Undo has no BE token yet. When set, the strip's Undo reverses for real
   * via `POST /api/undo/:token`.
   */
  undoToken?: string | null;
}

/**
 * Persistent reversible-action receipt. Sits at the top of the screen
 * until dismissed or the 7-day undo window expires — the visible safety
 * net the toast (transient) can't be.
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

  const { verb, count, historicTotal, timeLeft } = receipt;
  const headline =
    verb === 'Archive' || verb === 'Unsubscribe' || verb === 'Protect' || verb === 'Keep'
      ? `${VERB_PAST[verb]} ${count} sender${count === 1 ? '' : 's'}`
      : `${VERB_PAST[verb]} · ${count} sender${count === 1 ? '' : 's'}`;
  // Where the historic mail went — verb-correct (a Delete receipt must
  // never claim the mail was "archived"; D52 bulk wired Delete/Later
  // receipts through this strip).
  const historicSuffix =
    verb === 'Delete' ? 'moved to Trash' : verb === 'Later' ? 'moved to Later' : 'archived';

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px 10px 14px',
        background: color.emeraldBg,
        border: `1px solid rgba(5,150,105,0.25)`,
        borderRadius: 10,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 22,
          height: 22,
          borderRadius: 9999,
          background: color.emerald,
          color: '#FFFFFF',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>

      <span style={{ flex: 1, fontSize: 13, color: color.fg }}>
        <strong style={{ fontWeight: 600 }}>{headline}</strong>
        {historicTotal > 0 && (
          <span style={{ color: color.fgSoft }}>
            {' '}
            · {historicTotal.toLocaleString()} email{historicTotal === 1 ? '' : 's'}{' '}
            {historicSuffix}
          </span>
        )}
        <span
          style={{
            marginLeft: 8,
            fontFamily: font.mono,
            fontSize: 10.5,
            color: color.fgMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          reversible{timeLeft ? ` ${timeLeft}` : ''}
        </span>
      </span>

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
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
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
