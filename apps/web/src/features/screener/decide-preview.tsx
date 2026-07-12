'use client';

import { Button, tokens } from '@declutrmail/shared';
import { MailboxActionContext } from '@/features/auth/mailbox-action-context';

import type { ScreenerDecideVerb, ScreenerQueueRow } from './data';
import { VERB_LABEL } from './verbs';

const { color, font } = tokens;

/**
 * Live impact figure — the sender's current-inbox count from
 * `GET /api/actions/preview` (never a client estimate, D226).
 */
export type DecidePreviewCount = number | 'loading' | 'unavailable';

/**
 * The mandatory pre-mutation preview for a Screener decision (D226).
 *
 * Mounts inline inside the expanded row when a verb is pending —
 * mirroring the Triage inline-preview branch (the sheet MAY be
 * skipped; the preview cannot). Confirm dispatches the decision;
 * Cancel clears it. Copy per verb is literal and true to the pipeline
 * the verb rides:
 *
 *   - Keep        → nothing in Gmail changes (D72 soft quarantine).
 *   - Archive     → inbox mail moves to Gmail archive, undoable 7d.
 *   - Later       → inbox mail moves to DeclutrMail/Later, undoable 7d.
 *   - Unsubscribe → one-click sends the real request (one-way, D58);
 *                   mailto is the manual compose path (D230).
 *   - Delete      → Gmail Trash; 30-day recovery window.
 */
export function DecidePreview({
  verb,
  row,
  inboxCount,
  confirming,
  mailboxEmail,
  onConfirm,
  onCancel,
}: {
  verb: ScreenerDecideVerb;
  row: ScreenerQueueRow;
  inboxCount: DecidePreviewCount;
  /** True while the decide POST / worker confirmation is in flight. */
  confirming: boolean;
  /** Explicit override for isolated previews; app surfaces use active auth context. */
  mailboxEmail?: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const name = row.senderName;

  const title =
    verb === 'keep'
      ? `Keep ${name}`
      : verb === 'archive'
        ? `Archive all inbox mail from ${name}`
        : verb === 'later'
          ? `Move ${name} to Later`
          : verb === 'unsubscribe'
            ? `Unsubscribe from ${name}`
            : `Delete ${name}'s inbox mail`;

  const lead =
    verb === 'keep'
      ? `${name} stays exactly where it is — nothing in Gmail changes. We just remember your decision and stop asking about this sender.`
      : verb === 'archive'
        ? `Matching inbox mail from ${name} moves into Gmail's archive when the action runs. Nothing is deleted; Activity shows your plan's undo window.`
        : verb === 'later'
          ? `Matching inbox mail from ${name} moves into DeclutrMail/Later when the action runs. Activity shows your plan's undo window.`
          : verb === 'unsubscribe'
            ? row.unsubscribeMethod === 'one_click'
              ? `DeclutrMail sends ${name}'s one-click request and records whether the endpoint accepted it. The sender controls whether and when mail stops. The request itself can't be undone. Nothing already in your inbox moves.`
              : row.unsubscribeMethod === 'mailto'
                ? `Their list takes unsubscribes by email, so you send the final request from your mailbox — after you confirm, a button opens a prefilled Gmail compose and you hit Send. DeclutrMail never auto-sends from a no-reply address.`
                : `${name} advertises no unsubscribe channel. We record your decision; Archive is the reliable fallback if mail keeps coming.`
            : `Matching inbox mail from ${name} moves to Gmail Trash when the action runs. Activity can undo while Gmail retains the message, up to 30 days; emptying Trash can end recovery sooner.`;

  // What actually moves — only the label-modify verbs touch the inbox.
  const moves = verb === 'archive' || verb === 'later' || verb === 'delete';
  const previewBlocked = moves && (inboxCount === 'loading' || inboxCount === 'unavailable');
  const confirmDisabled = confirming || previewBlocked;

  return (
    <div
      role="region"
      aria-label={`Preview · ${VERB_LABEL[verb]} ${name}`}
      style={{
        background: color.paper,
        border: `1px solid ${verb === 'delete' ? color.red : color.line}`,
        borderRadius: 9,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        fontFamily: font.sans,
      }}
    >
      <span
        style={{
          fontFamily: font.mono,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: verb === 'delete' ? color.red : color.primary,
        }}
      >
        Preview · before anything changes
      </span>

      <MailboxActionContext mailboxEmail={mailboxEmail} />

      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.012em', margin: 0 }}>
          {title}
        </h3>
        <p style={{ fontSize: 12.5, color: color.fgSoft, margin: '4px 0 0', lineHeight: 1.5 }}>
          {lead}
        </p>
      </div>

      {/* Current match count, fetched server-side (D226). */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          padding: '10px 12px',
          background: color.card,
          border: `1px solid ${color.line}`,
          borderRadius: 8,
        }}
      >
        <ImpactFigure moves={moves} inboxCount={inboxCount} />
      </div>

      {/* Engine recap — why the engine queued this sender. */}
      {row.recommendation != null && (
        <div style={{ fontSize: 12, color: color.fgMuted, lineHeight: 1.5 }}>
          <span style={{ fontWeight: 600, color: color.fgSoft }}>Engine's read: </span>
          {row.recommendation.reasoning}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button size="sm" tone="ghost" onClick={onCancel} disabled={confirming}>
          Cancel
        </Button>
        <Button
          size="sm"
          tone={verb === 'delete' ? 'danger' : 'primary'}
          onClick={onConfirm}
          disabled={confirmDisabled}
          ariaLabel={`Confirm ${VERB_LABEL[verb]} for ${name}`}
        >
          {confirming ? 'Confirming…' : `Confirm ${VERB_LABEL[verb]}`}
        </Button>
      </div>
    </div>
  );
}

/** The "N emails move" strip — all four edge states rendered (D211). */
function ImpactFigure({ moves, inboxCount }: { moves: boolean; inboxCount: DecidePreviewCount }) {
  const strongStyle: React.CSSProperties = {
    fontFamily: font.display,
    fontSize: 18,
    fontWeight: 600,
    letterSpacing: '-0.02em',
    color: color.fg,
    fontVariantNumeric: 'tabular-nums',
  };
  const captionStyle: React.CSSProperties = { fontSize: 12, color: color.fgSoft };

  if (!moves) {
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
        Couldn&apos;t load a live preview. Cancel and retry — no inbox mail can move without one.
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
