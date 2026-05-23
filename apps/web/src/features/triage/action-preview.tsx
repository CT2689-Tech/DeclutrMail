'use client';

import { tokens } from '@declutrmail/shared';
import type { TriageDecisionRow } from './data';
import type { ActionVerb } from './types';

const { color, font } = tokens;

/**
 * The mandatory "what happens next" preview (D208, D226).
 *
 * Used in two places — same component, two mountings:
 *
 *   1. Inside `<ActionSheet>` when the user hasn't enabled the
 *      remember-preference for this verb. Renders below the sheet's
 *      title + lead.
 *
 *   2. Inline beneath the focused triage row when the
 *      remember-preference IS enabled — D34's "skip the sheet"
 *      branch. The preview is STILL rendered (D226: preview is
 *      mandatory), but as a non-modal strip instead of a dialog.
 *
 * Variant `mode` only changes the chrome — the content (counts,
 * historic backlog hint, reasoning recap, what-changes copy) is
 * identical so the user sees the same "before anything changes"
 * surface either way. That same-surface guarantee is the load-bearing
 * piece of D226 — preview never silently downgrades.
 */
export function ActionPreview({
  verb,
  row,
  archiveHistoric,
  mode,
}: {
  verb: ActionVerb;
  row: TriageDecisionRow;
  /**
   * Whether the historic backlog will also be archived. Set by the
   * sheet's toggle; for inline mode the default is the same as the
   * sheet would default (Unsubscribe defaults `true`, Later `false`,
   * Archive ignores).
   */
  archiveHistoric: boolean;
  /** Chrome variant — modal (inside sheet) vs inline (no chrome). */
  mode: 'modal' | 'inline';
}) {
  const subject = row.senderName;
  const historic = row.totalAllTime;

  // Copy per verb — kept literal so the wording matches the senders
  // feature's `ConfirmActionModal` byte-for-byte. Both surfaces are
  // the same "preview before anything changes" guarantee.
  const title =
    verb === 'Archive'
      ? `Archive all mail from ${subject}`
      : verb === 'Later'
        ? `Move ${subject} to Later`
        : verb === 'Unsubscribe'
          ? `Unsubscribe from ${subject}`
          : `Keep ${subject}`;

  const lead =
    verb === 'Archive'
      ? `Every message from ${subject} moves out of the inbox into Gmail's archive. Nothing is deleted.`
      : verb === 'Later'
        ? `Future mail from ${subject} skips the inbox and lands in a DeclutrMail/Later label. Nothing is unsubscribed or deleted.`
        : verb === 'Unsubscribe'
          ? row.unsubscribeMethod === 'one_click'
            ? `Future mail from ${subject} stops arriving (RFC 8058 one-click). Nothing already in your inbox moves unless you ask.`
            : `Future mail from ${subject} stops arriving once you send the unsubscribe request from your mailbox. Mailto is queued as a draft — DeclutrMail never auto-sends from a no-reply address.`
          : `${subject} stays in the inbox. No mail is moved.`;

  // For Archive: every historic message is touched. For Unsubscribe /
  // Later: only if the historic toggle is on. Keep: never.
  const touched =
    verb === 'Archive'
      ? historic
      : (verb === 'Unsubscribe' || verb === 'Later') && archiveHistoric
        ? historic
        : 0;

  const containerStyle: React.CSSProperties =
    mode === 'inline'
      ? {
          background: color.paper,
          border: `1px solid ${color.line}`,
          borderRadius: 9,
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          fontFamily: font.sans,
        }
      : {
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        };

  return (
    <div
      role="region"
      aria-label={`Preview · ${verb} ${subject}`}
      data-dm-preview-mode={mode}
      style={containerStyle}
    >
      {mode === 'inline' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: color.primary,
            }}
          >
            Preview · before anything changes
          </span>
        </div>
      )}

      <div>
        <h3
          style={{
            fontSize: mode === 'modal' ? 19 : 14,
            fontWeight: 600,
            letterSpacing: '-0.012em',
            margin: 0,
          }}
        >
          {title}
        </h3>
        <p
          style={{
            fontSize: 12.5,
            color: color.fgSoft,
            margin: '4px 0 0',
            lineHeight: 1.5,
          }}
        >
          {lead}
        </p>
      </div>

      {/* Impact figure */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          padding: '10px 12px',
          background: mode === 'inline' ? color.card : color.paper,
          border: `1px solid ${color.line}`,
          borderRadius: 8,
        }}
      >
        <strong
          style={{
            fontFamily: font.display,
            fontSize: mode === 'modal' ? 22 : 18,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: color.fg,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {touched.toLocaleString()}
        </strong>
        <span style={{ fontSize: 12, color: color.fgSoft }}>
          historic email{touched === 1 ? '' : 's'}
          {touched === 0
            ? ' will stay where they are (future mail only).'
            : ' will move out of the inbox.'}
        </span>
      </div>

      {/* Reasoning recap — the engine's "why this verdict" copy. */}
      {verb !== 'Keep' && (
        <div
          style={{
            fontSize: 12,
            color: color.fgMuted,
            lineHeight: 1.5,
            fontFamily: font.sans,
          }}
        >
          <span style={{ fontWeight: 600, color: color.fgSoft }}>Why we suggested this: </span>
          {row.reasoning}
        </div>
      )}
    </div>
  );
}
