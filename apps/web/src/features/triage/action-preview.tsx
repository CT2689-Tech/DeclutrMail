'use client';

import { tokens } from '@declutrmail/shared';
import { buildActionPresentation } from '@declutrmail/shared/actions';
import { getActionFailureCopy } from '@/lib/action-error-copy';
import type { TriageDecisionRow } from './data';
import type { ActionVerb } from './types';

const { color, font } = tokens;

/**
 * The live "what moves" figure for the preview — the sender's
 * current-inbox count from `GET /api/actions/preview` (ADR-0020).
 * `loading` while the preview query is in flight; `unavailable` when
 * it failed (the preview still renders — the count is best-effort,
 * the verb copy is not).
 */
export type PreviewCount = number | 'loading' | 'unavailable';

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
 *
 * The impact figure is the REAL inbox count fetched server-side
 * (`inboxCount`), never a client estimate — same D226 rule the
 * senders confirm modal follows.
 */
export function ActionPreview({
  verb,
  row,
  archiveHistoric,
  inboxCount,
  wakeAt,
  mode,
}: {
  verb: ActionVerb;
  row: TriageDecisionRow;
  /**
   * Whether the historic backlog will also be archived (Unsubscribe
   * only — set by the sheet's toggle; the inline path defaults `true`
   * for Unsubscribe, matching the sheet's default).
   */
  archiveHistoric: boolean;
  /** Live inbox count for the sender — see {@link PreviewCount}. */
  inboxCount: PreviewCount;
  /** Exact Later return time confirmed by the pending action. */
  wakeAt?: string | null;
  /** Chrome variant — modal (inside sheet) vs inline (no chrome). */
  mode: 'modal' | 'inline';
}) {
  const subject = row.senderName;

  const actionVerb = verb.toLowerCase() as 'keep' | 'archive' | 'unsubscribe' | 'later';
  const liveCount = typeof inboxCount === 'number' ? inboxCount : null;
  const presentation = buildActionPresentation({
    verb: actionVerb,
    liveCount: actionVerb === 'keep' || actionVerb === 'unsubscribe' ? 0 : liveCount,
    planUndoDeadline: null,
    wakeAt: actionVerb === 'later' ? (wakeAt ?? null) : null,
    unsubscribeChannel: actionVerb === 'unsubscribe' ? row.unsubscribeMethod : null,
    secondaryAction:
      actionVerb === 'unsubscribe' && archiveHistoric ? { verb: 'archive', liveCount } : null,
  });

  const title =
    verb === 'Archive'
      ? `Archive all inbox mail from ${subject}`
      : verb === 'Later'
        ? `Move ${subject} to Later`
        : verb === 'Unsubscribe'
          ? `Unsubscribe from ${subject}`
          : `Keep ${subject}`;

  const lead = presentation.previewCopy;

  // What actually moves: Archive + Later act on the sender's current
  // inbox mail; Unsubscribe only when the historic toggle is on;
  // Keep never.
  const counts: boolean =
    verb === 'Archive' || verb === 'Later' || (verb === 'Unsubscribe' && archiveHistoric);

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

      {/* Impact figure — the REAL count, fetched server-side. */}
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
        <ImpactFigure counts={counts} inboxCount={inboxCount} mode={mode} />
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

/**
 * The "N emails move" strip. Four states, all rendered (D211 — edge
 * states are first-class):
 *
 *   - `counts=false` — the verb touches nothing in the inbox.
 *   - counting       — the live count is still loading.
 *   - unavailable    — the count fetch failed; say so plainly rather
 *                      than showing a stale or estimated number.
 *   - n              — the real figure.
 */
function ImpactFigure({
  counts,
  inboxCount,
  mode,
}: {
  counts: boolean;
  inboxCount: PreviewCount;
  mode: 'modal' | 'inline';
}) {
  const strongStyle: React.CSSProperties = {
    fontFamily: font.display,
    fontSize: mode === 'modal' ? 22 : 18,
    fontWeight: 600,
    letterSpacing: '-0.02em',
    color: color.fg,
    fontVariantNumeric: 'tabular-nums',
  };
  const captionStyle: React.CSSProperties = { fontSize: 12, color: color.fgSoft };

  if (!counts) {
    return (
      <>
        <strong style={strongStyle}>0</strong>
        <span style={captionStyle}>emails move — everything in the inbox stays where it is.</span>
      </>
    );
  }
  if (inboxCount === 'loading') {
    return <span style={captionStyle}>Counting the inbox…</span>;
  }
  if (inboxCount === 'unavailable') {
    return <span style={captionStyle}>{getActionFailureCopy('preview').message}</span>;
  }
  return (
    <>
      <strong style={strongStyle}>{inboxCount.toLocaleString()}</strong>
      <span style={captionStyle}>
        email{inboxCount === 1 ? '' : 's'} now in the inbox
        {inboxCount === 0 ? ' — nothing to move.' : ' will move out of the inbox.'}
      </span>
    </>
  );
}
