'use client';

import { Button, tokens } from '@declutrmail/shared';
import {
  buildActionPresentation,
  describeInboxScope,
  inboxScopeNoticeCopy,
} from '@declutrmail/shared/actions';
import { MailboxActionContext } from '@/features/auth/mailbox-action-context';

import {
  needsProtectedOverride,
  protectionReasonLabel,
  type ScreenerDecideVerb,
  type ScreenerQueueRow,
} from './data';
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
 *   - Archive     → inbox mail moves to Gmail archive; plan-based Activity Undo.
 *   - Later       → inbox mail moves to DeclutrMail/Later; exact return time required.
 *   - Unsubscribe → one-click sends the real request (one-way, D58);
 *                   mailto is the manual compose path (D230).
 *   - Delete      → Activity Undo plus a separate Gmail Trash recovery path.
 */
export function DecidePreview({
  verb,
  row,
  inboxCount,
  wakeAt,
  confirming,
  mailboxEmail,
  onConfirm,
  onCancel,
}: {
  verb: ScreenerDecideVerb;
  row: ScreenerQueueRow;
  inboxCount: DecidePreviewCount;
  wakeAt?: string | null;
  /** True while the decide POST / worker confirmation is in flight. */
  confirming: boolean;
  /** Explicit override for isolated previews; app surfaces use active auth context. */
  mailboxEmail?: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const name = row.senderName;
  const liveCount = typeof inboxCount === 'number' ? inboxCount : null;
  const presentation = buildActionPresentation({
    verb,
    liveCount: verb === 'keep' || verb === 'unsubscribe' ? 0 : liveCount,
    planUndoDeadline: null,
    wakeAt: verb === 'later' ? (wakeAt ?? null) : null,
    unsubscribeChannel: verb === 'unsubscribe' ? row.unsubscribeMethod : null,
  });

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

  const lead = presentation.previewCopy;

  // What actually moves — only the label-modify verbs touch the inbox.
  const moves = verb === 'archive' || verb === 'later' || verb === 'delete';
  const previewBlocked = moves && (inboxCount === 'loading' || inboxCount === 'unavailable');
  const confirmDisabled = confirming || previewBlocked;

  // A Protected sender decided EXPLICITLY, one at a time — the path
  // D245 leaves open (it excludes Protected from bulk and automatic
  // actions, not from a deliberate click). Name the protection and make
  // the confirm carry the acknowledgement, so the user is never sent
  // away to unprotect a sender they are about to act on anyway.
  const overriding = needsProtectedOverride(row, verb);
  const confirmLabel = confirming
    ? 'Confirming…'
    : overriding
      ? `Confirm ${VERB_LABEL[verb]} anyway`
      : `Confirm ${VERB_LABEL[verb]}`;

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
          // Wraps so the scope notice can take its own line under the
          // figure instead of squeezing the count.
          flexWrap: 'wrap',
          gap: 8,
          padding: '10px 12px',
          background: color.card,
          border: `1px solid ${color.line}`,
          borderRadius: 8,
        }}
      >
        <ImpactFigure moves={moves} inboxCount={inboxCount} verbLabel={VERB_LABEL[verb]} />
      </div>

      {/* Protected acknowledgement (D42/D245) — stated before the
          confirm, never after the fact. `role="status"` so a screen
          reader hears it when the preview opens. */}
      {overriding && (
        <div
          role="status"
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            color: color.red,
            background: color.card,
            border: `1px solid ${color.red}`,
            borderRadius: 8,
            padding: '8px 10px',
          }}
        >
          <strong style={{ fontWeight: 600 }}>This sender is Protected</strong> — {name} is kept
          safe because {protectionReasonLabel(row.protectionReason)}. Confirming acts on it anyway;
          it stays Protected afterwards.
        </div>
      )}

      {/* Engine recap — why the engine queued this sender. */}
      {row.recommendation != null && (
        <div style={{ fontSize: 12, color: color.fgMuted, lineHeight: 1.5 }}>
          <span style={{ fontWeight: 600, color: color.fgSoft }}>Why this is suggested: </span>
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
          // Stable across the in-flight transition — a button that
          // renames itself mid-action loses its accessible identity.
          ariaLabel={`Confirm ${VERB_LABEL[verb]}${overriding ? ' anyway' : ''} for ${name}`}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

/** The "N emails move" strip — all four edge states rendered (D211). */
function ImpactFigure({
  moves,
  inboxCount,
  verbLabel,
}: {
  moves: boolean;
  inboxCount: DecidePreviewCount;
  verbLabel: string;
}) {
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
  // A bare "0" beside the row's "Messages received" count reads as lost
  // mail. Same reconciliation the senders confirm modal does, from the
  // same helper. The screener has no windowing and no 30-day arrival
  // figure on its row, so `recentArrivals` is null and the copy omits
  // that clause rather than passing off an all-labels received count as a
  // 30-day arrival count.
  const scopeCopy = inboxScopeNoticeCopy(
    describeInboxScope({
      inboxTotal: inboxCount,
      windowCount: inboxCount,
      olderThanDays: null,
      recentArrivals: null,
    }),
    verbLabel,
  );

  return (
    <>
      <strong style={strongStyle}>{inboxCount.toLocaleString()}</strong>
      <span style={captionStyle}>
        email{inboxCount === 1 ? '' : 's'} currently match in Inbox. Gmail is checked again at
        execution, so the final moved count can change.
      </span>
      {scopeCopy && (
        <span role="status" style={{ ...captionStyle, flexBasis: '100%' }}>
          {scopeCopy}
        </span>
      )}
    </>
  );
}
