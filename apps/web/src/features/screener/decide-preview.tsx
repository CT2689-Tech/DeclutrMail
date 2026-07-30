'use client';

import { Button, tokens } from '@declutrmail/shared';
import {
  buildActionPresentation,
  describeInboxScope,
  inboxScopeNoticeCopy,
} from '@declutrmail/shared/actions';
import { MailboxActionContext } from '@/features/auth/mailbox-action-context';
import type { ActionReach } from '@/lib/api/actions';

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
  allMailCount = null,
  reach = 'inbox_only',
  onReachChange,
  wakeAt,
  confirming,
  mailboxEmail,
  onConfirm,
  onCancel,
}: {
  verb: ScreenerDecideVerb;
  row: ScreenerQueueRow;
  inboxCount: DecidePreviewCount;
  /**
   * ADR-0028 — the sender's all-mail count (inbox + archived) from the
   * same composite preview. `null` = the API predates the field or the
   * preview has not resolved; the reach chips then do not render.
   */
  allMailCount?: number | null;
  /** ADR-0028 — the selected reach for a pending Delete. */
  reach?: ActionReach;
  onReachChange?: ((reach: ActionReach) => void) | undefined;
  wakeAt?: string | null;
  /** True while the decide POST / worker confirmation is in flight. */
  confirming: boolean;
  /** Explicit override for isolated previews; app surfaces use active auth context. */
  mailboxEmail?: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const name = row.senderName;
  // ADR-0028 reach. Offered only where the server accepts it — a Delete
  // — and only when the preview actually carries the all-mail block
  // (mirrors the senders confirm modal's `reachAvailable` gate).
  const reachAvailable = verb === 'delete' && allMailCount != null;
  const activeReach: ActionReach = reachAvailable ? reach : 'inbox_only';
  // The ONE count the preview arms — under the SELECTED reach.
  const effectiveCount: DecidePreviewCount =
    activeReach === 'all_mail' && allMailCount != null ? allMailCount : inboxCount;
  const liveCount = typeof effectiveCount === 'number' ? effectiveCount : null;
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
            : activeReach === 'all_mail'
              ? `Delete ${name}'s inbox + archived mail`
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

      {/* ADR-0028 reach chip pair — Delete only, adapted from the
          senders confirm modal's presentation. The chips carry the live
          counts so "Inbox + archived" is discoverable exactly when the
          inbox count reads low. */}
      {reachAvailable && (
        <div
          role="radiogroup"
          aria-label="Where it applies"
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          <div
            style={{
              fontFamily: font.mono,
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: color.fgMuted,
            }}
          >
            Where it applies
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(
              [
                { value: 'inbox_only', label: 'Inbox only', count: liveInboxNumber(inboxCount) },
                { value: 'all_mail', label: 'Inbox + archived', count: allMailCount },
              ] as const satisfies ReadonlyArray<{
                value: ActionReach;
                label: string;
                count: number | null;
              }>
            ).map((opt) => {
              const active = activeReach === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onReachChange?.(opt.value)}
                  style={{
                    fontFamily: font.sans,
                    fontSize: 12.5,
                    fontWeight: 500,
                    padding: '6px 12px',
                    borderRadius: 999,
                    background: active ? color.fg : 'transparent',
                    color: active ? color.fgInverse : color.fgSoft,
                    border: `1px solid ${active ? color.fg : color.line}`,
                    cursor: 'pointer',
                    transition: 'background 120ms, color 120ms',
                  }}
                >
                  {opt.label}
                  {opt.count !== null && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontVariantNumeric: 'tabular-nums',
                        opacity: active ? 0.85 : 0.7,
                      }}
                    >
                      {opt.count.toLocaleString()}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {activeReach === 'all_mail' && (
            <span style={{ fontSize: 11.5, color: color.fgMuted, lineHeight: 1.45 }}>
              Includes archived mail. Trash, Spam, Drafts and Chat are never touched. Undo restores
              every email — inbox mail to the inbox, archived mail to the archive.
            </span>
          )}
        </div>
      )}

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
        <ImpactFigure
          moves={moves}
          count={effectiveCount}
          verbLabel={VERB_LABEL[verb]}
          allMailReach={activeReach === 'all_mail'}
          reachAvailable={reachAvailable}
        />
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

/** Chip-count coercion — a not-yet-resolved live count renders no figure. */
function liveInboxNumber(count: DecidePreviewCount): number | null {
  return typeof count === 'number' ? count : null;
}

/** The "N emails move" strip — all four edge states rendered (D211). */
function ImpactFigure({
  moves,
  count,
  verbLabel,
  allMailReach,
  reachAvailable,
}: {
  moves: boolean;
  /** Live count under the SELECTED reach (ADR-0028). */
  count: DecidePreviewCount;
  verbLabel: string;
  /** True when the widened `all_mail` reach is active. */
  allMailReach: boolean;
  /** True when the reach chips are on screen (softens the scope notice). */
  reachAvailable: boolean;
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
  if (count === 'loading') {
    return <span style={captionStyle}>Counting the inbox…</span>;
  }
  if (count === 'unavailable') {
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
  // 30-day arrival count. At all-mail reach the notice stays silent —
  // archived mail IS in scope, so an inbox reconciliation would narrate
  // a scope the action no longer has (same suppression as the senders
  // modal). With the chips on screen, `verbActsBeyondInbox` swaps
  // "only acts on" for "acts on inbox mail by default" (ADR-0028).
  const scopeCopy = allMailReach
    ? null
    : inboxScopeNoticeCopy(
        describeInboxScope({
          inboxTotal: count,
          windowCount: count,
          olderThanDays: null,
          recentArrivals: null,
        }),
        verbLabel,
        'this sender',
        { verbActsBeyondInbox: reachAvailable },
      );

  return (
    <>
      <strong style={strongStyle}>{count.toLocaleString()}</strong>
      <span style={captionStyle}>
        email{count === 1 ? '' : 's'} currently match{' '}
        {allMailReach ? 'across inbox + archived' : 'in Inbox'}. Gmail is checked again at
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
