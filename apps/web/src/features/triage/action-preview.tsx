'use client';

import { tokens } from '@declutrmail/shared';
import { MailboxActionContext } from '@/features/auth/mailbox-action-context';
import type { TriageDecisionRow } from './data';
import type { ActionVerb } from './types';

const { color, font } = tokens;

/**
 * The live "what moves" figure for the preview — the sender's
 * current-inbox count from `GET /api/actions/preview` (ADR-0020).
 * `loading` while the preview query is in flight; `unavailable` when
 * it failed. The owning confirm surface fails closed for mail-moving
 * verbs until this value is numeric.
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
 * The impact figure is the current inbox match count fetched server-side
 * (`inboxCount`), never a client estimate. The worker re-checks Gmail at
 * execution, so this preview is not a promise of the final affected count.
 */
export function ActionPreview({
  verb,
  row,
  archiveHistoric,
  inboxCount,
  mode,
  mailboxEmail,
}: {
  verb: ActionVerb;
  row: TriageDecisionRow;
  /**
   * Whether the historic backlog will also be archived (Unsubscribe
   * only — set by the sheet's toggle; the inline path defaults `false`
   * so a separate backlog mutation is never assumed).
   */
  archiveHistoric: boolean;
  /** Live inbox count for the sender — see {@link PreviewCount}. */
  inboxCount: PreviewCount;
  /** Chrome variant — modal (inside sheet) vs inline (no chrome). */
  mode: 'modal' | 'inline';
  /** Explicit override for isolated previews; app surfaces use active auth context. */
  mailboxEmail?: string | undefined;
}) {
  const subject = row.senderName;

  // Copy per verb — literal, and TRUE to the pipeline each verb rides:
  // Archive/Later move the sender's current inbox mail via the worker;
  // Unsubscribe sends the real one-click request (D9 Wave 2) or opens
  // the manual Gmail-compose path (mailto stays manual per D230);
  // Keep moves nothing.
  const title =
    verb === 'Archive'
      ? `Archive all inbox mail from ${subject}`
      : verb === 'Later'
        ? `Move ${subject} to Later`
        : verb === 'Unsubscribe'
          ? `Unsubscribe from ${subject}`
          : `Keep ${subject}`;

  const lead =
    verb === 'Archive'
      ? `Matching inbox mail from ${subject} moves into Gmail's archive when the action runs. Nothing is deleted; Activity shows your plan's undo window.`
      : verb === 'Later'
        ? `Matching inbox mail from ${subject} moves into the DeclutrMail/Later label when the action runs. Nothing is unsubscribed or deleted; Activity shows your plan's undo window.`
        : verb === 'Unsubscribe'
          ? row.unsubscribeMethod === 'one_click'
            ? // Locked-copy ban per spec v1.2 Decision 15: "RFC 8058
              // one-click" jargon → "one-click unsubscribe." D58: the
              // request can't be recalled once their list takes it.
              `DeclutrMail sends ${subject}'s one-click request and records whether the endpoint accepted it. The sender controls whether and when mail stops. The request itself can't be undone. Nothing already in your inbox moves unless you ask below.`
            : row.unsubscribeMethod === 'mailto'
              ? `Their list takes unsubscribes by email, so you send the final request from your mailbox — after you confirm, a button opens a prefilled Gmail compose and you hit Send. DeclutrMail never auto-sends from a no-reply address.`
              : `${subject} publishes no unsubscribe channel. No request can be sent; use Archive to move existing mail instead.`
          : `${subject} stays in the inbox. No mail is moved.`;

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

      <MailboxActionContext mailboxEmail={mailboxEmail} />

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

      {/* Current match count, fetched server-side. */}
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
    return (
      <span style={captionStyle}>
        Couldn't load a live preview. Close and retry — no inbox mail can move without one.
      </span>
    );
  }
  return (
    <>
      <strong style={strongStyle}>{inboxCount.toLocaleString()}</strong>
      <span style={captionStyle}>
        email{inboxCount === 1 ? '' : 's'} currently match in Inbox. Gmail is checked again at
        execution, so the final moved count can change.
      </span>
    </>
  );
}
