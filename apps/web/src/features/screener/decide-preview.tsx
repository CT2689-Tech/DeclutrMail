'use client';

import { useActionPreviewAnalytics } from '@/lib/use-action-preview-analytics';
import { MailboxActionContextView } from '../auth/mailbox-action-context-view';

import { Button, Disclosure, SheetFactList, tokens, type SheetFactItem } from '@declutrmail/shared';
import {
  buildActionPresentation,
  describeInboxScope,
  inboxScopeNoticeCopy,
} from '@declutrmail/shared/actions';
import { ENGINE_ABSTENTION_COPY, scoredAgeLabel } from '@declutrmail/shared/copy';
import { WS2_COPY, WS5_COPY } from '@declutrmail/shared/copy/launch';
import { getActiveMailboxEmail, useOptionalAuth } from '@/features/auth/auth-provider';
import { PREVIEW_DETAILS, previewIncludesValue } from '@declutrmail/shared/copy';
import { afterLead } from '@/lib/copy/after-lead';
import { useNow } from '@/lib/use-now';
import { ActionReachControl } from '@/components/action-scope-controls';
import {
  CleanupImpact,
  CleanupPreview,
  UnsubscribeImpact,
  cleanupActionTitle,
  cleanupInboxHasNone,
} from '@/components/cleanup-preview';
import { LaterReturnControl, useFutureReturnTime } from '@/components/later-return-control';
import type { ActionReach } from '@/lib/api/actions';

import {
  canScreenerUnsubscribe,
  needsProtectedOverride,
  screenerProtectionClause,
  type ScreenerDecideVerb,
  type ScreenerQueueRow,
} from './data';
import { VERB_LABEL } from './verbs';

const { color, font, radius, space, text } = tokens;
const CLEANUP_AGE_OPTIONS = [null, 30, 90, 180, 365].map((days) => ({ days }));

/**
 * Live impact figure — the sender's current-inbox count from
 * `GET /api/actions/preview` (never a client estimate, D226).
 */
export type DecidePreviewCount = number | 'loading' | 'unavailable';

/**
 * The mandatory pre-mutation preview for a Screener decision (D226).
 *
 * Mounts inline inside the expanded row when a verb is pending, in the
 * grammar of Triage's `InlinePreviewBlock` (ADR-0042). Archive/Delete
 * name the sender in the title and put the count/destination and recovery
 * beside the action; other verbs retain their compact presentation.
 * Supported controls remain visible; other facts stay behind Details. Confirm dispatches the decision;
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
  showSuggestion = true,
  inboxCount,
  inboxTotal = null,
  windowDays = null,
  onWindowChange,
  allMailCount = null,
  allMailTotal = null,
  reach = 'inbox_only',
  onReachChange,
  wakeAt,
  onWakeAtChange,
  confirming,
  mailboxEmail,
  onConfirm,
  onCancel,
  onRetryPreview,
  onChooseDecision,
}: {
  verb: ScreenerDecideVerb;
  row: ScreenerQueueRow;
  /** Keep a suppressed row recommendation out of preview Details too. */
  showSuggestion?: boolean;
  inboxCount: DecidePreviewCount;
  /**
   * QA-delete-20260829-01 — the TRUE un-windowed inbox count
   * (`counts.all`), for the empty-window reconciliation notice.
   * `null` while the preview hasn't resolved.
   */
  inboxTotal?: number | null;
  /**
   * QA-delete-20260829-01 — the day-window currently applied to
   * `inboxCount`, if any. Manual previews start at Any age (null);
   * callers keep an explicit older-only selection until cancel/confirm.
   */
  windowDays?: number | null;
  onWindowChange?: ((days: number | null) => void) | undefined;
  /**
   * ADR-0028 — the sender's all-mail count (inbox + archived) from the
   * same composite preview. `null` = the API predates the field or the
   * preview has not resolved; the reach chips then do not render.
   */
  allMailCount?: number | null;
  /**
   * Codex review 2026-09-03 (QA-delete-20260903-01, round 2): the TRUE
   * un-windowed all-mail total. `allMailCount` above is windowed
   * identically to `inboxCount` for a pending Delete, so the zero-match
   * title check needs this separate, always-unwindowed figure to tell
   * "genuinely nothing archived" from "archived mail exists, just
   * outside the window" once `all_mail` reach is selected.
   */
  allMailTotal?: number | null;
  /** ADR-0028 — the selected reach for a pending Delete. */
  reach?: ActionReach;
  onReachChange?: ((reach: ActionReach) => void) | undefined;
  wakeAt?: string | null;
  onWakeAtChange?: ((wakeAt: string | null) => void) | undefined;
  /** True while the decide POST / worker confirmation is in flight. */
  confirming: boolean;
  /** Explicit override for isolated previews; app surfaces use active auth context. */
  mailboxEmail?: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
  onRetryPreview?: (() => void) | undefined;
  /** Opens the existing decision preview; never confirms or mutates directly. */
  onChooseDecision?: ((verb: ScreenerDecideVerb) => void) | undefined;
}) {
  useActionPreviewAnalytics(row.senderId, verb, typeof inboxCount === 'number');
  const name = row.senderName;
  const isCleanupAction = verb === 'archive' || verb === 'delete' || verb === 'later';
  // ADR-0028 reach. Widening stays possible only when the preview carries
  // the all-mail count. Without that count the checkbox stays disabled.
  const reachAvailable = verb === 'delete' && allMailCount != null;
  const activeReach: ActionReach = verb === 'delete' ? reach : 'inbox_only';
  // The ONE count the preview arms — under the SELECTED reach.
  const effectiveCount: DecidePreviewCount =
    activeReach === 'all_mail' ? (allMailCount ?? 'unavailable') : inboxCount;
  const liveCount = typeof effectiveCount === 'number' ? effectiveCount : null;
  // What actually moves — only the label-modify verbs touch the inbox.
  // Declared before `title` (QA-delete-20260903-01): a zero-match Archive/
  // Later/Delete needs to say so in the header, the same "Nothing to move"
  // branch `action-preview-presentation.tsx` already has for Triage.
  const moves = verb === 'archive' || verb === 'later' || verb === 'delete';
  // A zero age bucket is not proof of an empty sender. Require fresh,
  // unwindowed counts at both scopes before offering the review-only path.
  const noCurrentMail =
    moves && inboxCount === 0 && allMailCount === 0 && inboxTotal === 0 && allMailTotal === 0;
  // QA-archive-20260903-01: the frozen rationale below needs the same
  // "Last checked" age label Triage's identical D226 preview already
  // shows — this dialog is the one screen a destructive verb cannot
  // bypass, so a stale read should say so here too, not just on the
  // collapsed row.
  const now = useNow();
  const ageLabel =
    row.recommendation?.scoredAt !== undefined && now !== null
      ? scoredAgeLabel(row.recommendation.scoredAt, new Date(now))
      : null;
  const presentation = buildActionPresentation({
    verb,
    liveCount: verb === 'keep' || verb === 'unsubscribe' ? 0 : liveCount,
    planUndoDeadline: null,
    wakeAt: verb === 'later' ? (wakeAt ?? null) : null,
    unsubscribeChannel: verb === 'unsubscribe' ? row.unsubscribeMethod : null,
    // Absolute times render in the reader's own clock: every one of
    // these surfaces is opened by a click, never server-rendered.
    timeZone: 'viewer',
    // ADR-0028 — the lead must name the scope the chip just widened to.
    reach: activeReach,
  });

  // QA-delete-20260903-01: a zero-match Archive/Later/Delete otherwise
  // still reads as an active move ("Delete X's inbox email") directly
  // above a "0 matching emails" body — check this before the per-verb
  // wording, same order `action-preview-presentation.tsx` uses.
  //
  // Codex review 2026-09-03: unlike Triage's identical branch, Delete's
  // `liveCount` here can be WINDOWED (`windowDays` set, default delete
  // window) while the TRUE un-windowed count for the active reach is > 0.
  // "Nothing to move" would then contradict the scope notice just
  // below it, which already says N emails sit outside the window. Only
  // claim a true zero when no window narrowed the count, or the
  // un-windowed total for the SELECTED reach confirms it really is zero —
  // round 2: comparing against `inboxTotal` unconditionally was still
  // wrong at `all_mail` reach, where `liveCount` and `inboxTotal` measure
  // different scopes (all-mail vs inbox-only) that can each independently
  // be zero while the other is not.
  const relevantTrueTotal = activeReach === 'all_mail' ? allMailTotal : inboxTotal;
  const confidentZeroMatch = liveCount === 0 && (windowDays === null || relevantTrueTotal === 0);
  const allMailReach = activeReach === 'all_mail';
  const zero = moves && confidentZeroMatch;
  const { primary } = presentation;

  // ── One bold line: the count and where the email goes ───────────────
  const destination =
    verb === 'archive'
      ? 'They leave your inbox and stay in Gmail.'
      : verb === 'later'
        ? 'They wait in Gmail’s DeclutrMail/Later label, then return to your inbox.'
        : verb === 'delete'
          ? allMailReach
            ? 'Inbox and archived email both move to Gmail Trash.'
            : 'They move to Gmail Trash.'
          : null;
  const headline = noCurrentMail
    ? `No current email from ${name}`
    : zero
      ? `Nothing to move from ${name} right now`
      : verb === 'keep'
        ? `Keep ${name}?`
        : verb === 'unsubscribe'
          ? WS5_COPY['preview.title.unsubThisSender']
          : isCleanupAction
            ? cleanupActionTitle(
                verb === 'later' ? 'Later' : verb === 'delete' ? 'Delete' : 'Archive',
                name,
              )
            : verb === 'later'
              ? `Move ${liveCount === null ? 'email' : emailsLabel(liveCount)} to Later?`
              : `${VERB_LABEL[verb]} ${liveCount === null ? 'email' : emailsLabel(liveCount)}?`;
  const explanation = noCurrentMail
    ? 'There’s no inbox or archived email to move. This sender is still awaiting its first review.'
    : zero || verb === 'archive' || verb === 'later'
      ? null
      : verb === 'unsubscribe'
        ? primary.unsubscribeChannel.kind === 'not-applicable' ||
          primary.unsubscribeChannel.kind === 'varies'
          ? primary.futureMail.summary
          : primary.unsubscribeChannel.summary
        : verb === 'keep'
          ? 'Keep marks this sender reviewed. Email stays where it is.'
          : verb === 'delete'
            ? primary.futureMail.summary
            : `From ${name}. ${destination ?? ''}`;

  // ── One muted line: how to undo it ──────────────────────────────────
  // Keep records an app-only decision when there is no email to move.
  const note = noCurrentMail
    ? 'Choose Keep to finish this review without moving email.'
    : zero
      ? 'Choose Keep to record a decision without moving email.'
      : [
          primary.activityUndo.summary,
          ...(primary.bulkReturnNotice === null ? [] : [primary.bulkReturnNotice]),
        ].join(' ');

  const auth = useOptionalAuth();
  const activeMailboxEmail = mailboxEmail ?? (auth ? getActiveMailboxEmail(auth.me) : null);

  const previewBlocked =
    moves && (typeof inboxCount !== 'number' || typeof effectiveCount !== 'number');
  // A zero-match Delete would only remove the review row while moving no
  // email. Keep is the explicit app-only decision for that intent.
  const returnTimeValid = useFutureReturnTime(wakeAt, verb === 'later').valid;
  const returnInvalid = verb === 'later' && !returnTimeValid;
  const confirmDisabled =
    confirming || previewBlocked || (moves && liveCount === 0) || returnInvalid;

  // A Protected sender decided EXPLICITLY, one at a time — the path
  // D245 leaves open (it excludes Protected from bulk and automatic
  // actions, not from a deliberate click). Name the protection and make
  // the confirm carry the acknowledgement, so the user is never sent
  // away to unprotect a sender they are about to act on anyway.
  const overriding = needsProtectedOverride(row, verb);
  // Archive/Delete keep short labels; their live counts stay in the impact summary.
  const restingLabel = overriding
    ? `${VERB_LABEL[verb]} anyway`
    : isCleanupAction
      ? VERB_LABEL[verb]
      : moves && liveCount !== null && liveCount > 0
        ? verb === 'later'
          ? `Move ${emailsLabel(liveCount)} to Later`
          : `${VERB_LABEL[verb]} ${emailsLabel(liveCount)}`
        : VERB_LABEL[verb];
  const confirmLabel = confirming ? 'Confirming…' : restingLabel;

  // A bare "0" beside the row's "Messages received" count reads as lost
  // mail. Same reconciliation the senders confirm modal does, from the
  // same helper. QA-delete-20260829-01: the screener carries Delete's
  // default window (`windowDays`) and the TRUE un-windowed total
  // (`inboxTotal`), so an all-older-than-the-window sender gets the same
  // "0 email now, but N are outside the window" notice instead of a
  // silent zero. `recentArrivals` stays null — the screener has no 30-day
  // arrival figure to name. At all-mail reach the notice stays silent —
  // archived mail IS in scope. With the chips on screen,
  // `verbActsBeyondInbox` swaps "only acts on" for "acts on inbox mail by
  // default" (ADR-0028).
  const scopeNotice =
    moves && typeof effectiveCount === 'number' && !allMailReach
      ? describeInboxScope({
          inboxTotal: inboxTotal ?? effectiveCount,
          windowCount: effectiveCount,
          olderThanDays: windowDays,
          recentArrivals: null,
        })
      : null;
  const scopeCopy =
    scopeNotice === null
      ? null
      : isCleanupAction && scopeNotice.kind === 'empty-window'
        ? cleanupInboxHasNone(scopeNotice.inboxTotal, name, scopeNotice.olderThanDays)
        : inboxScopeNoticeCopy(scopeNotice, VERB_LABEL[verb], 'this sender', {
            verbActsBeyondInbox: reachAvailable,
          });
  // ── Details ─────────────────────────────────────────────────────────
  const facts: SheetFactItem[] = [];
  if (moves && liveCount !== null) {
    facts.push({
      label: PREVIEW_DETAILS.includes.label,
      value: previewIncludesValue(allMailReach, windowDays),
    });
  }
  if (allMailReach) {
    facts.push(
      { label: 'Never touched', value: 'Trash, Spam, Drafts, Chat' },
      { label: 'Undo', value: 'Puts each email back where it was' },
    );
  }
  if (verb === 'keep') {
    facts.push(
      { label: 'Gmail', value: primary.currentMail.summary.replace(/\.$/, '') },
      ...(primary.futureMail.inPreview
        ? [{ label: 'Triage', value: primary.futureMail.summary.replace(/\.$/, '') }]
        : []),
      ...primary.unchanged.map((fact) => ({
        label: 'Autopilot',
        value: fact.replace(/\.$/, ''),
      })),
    );
  }
  if (primary.schedule.kind === 'scheduled') {
    facts.push({
      label: 'Returns',
      value: afterLead(primary.schedule.summary, 'Returns to Inbox '),
    });
  } else if (primary.schedule.kind === 'required') {
    facts.push({ label: 'Returns', value: primary.schedule.summary.replace(/\.$/, '') });
  }
  if (primary.providerRecovery.kind === 'gmail-trash') {
    facts.push({
      label: PREVIEW_DETAILS.deleted.label,
      value: PREVIEW_DETAILS.deleted.value,
    });
  }
  // Engine recap — why the engine queued this sender, and how old that
  // read is (QA-archive-20260903-01).
  if (showSuggestion && row.recommendation != null) {
    facts.push({
      label:
        row.recommendation.verdict === 'later'
          ? ENGINE_ABSTENTION_COPY.context
          : PREVIEW_DETAILS.whySuggested.label,
      value: (
        <>
          {row.recommendation.reasoning}
          {ageLabel !== null && (
            <>
              {' '}
              <span style={{ color: color.fgMuted, whiteSpace: 'nowrap' }}>{ageLabel}</span>
            </>
          )}
        </>
      ),
    });
  }

  const mutedLine = { margin: `${space[1]}px 0 0`, fontSize: text.sm, color: color.fgMuted };

  return (
    <div
      role="region"
      aria-label={`Preview · ${VERB_LABEL[verb]} ${name}`}
      data-dm-preview-mode="inline"
      style={{
        textAlign: 'left',
        padding: space[4],
        borderRadius: radius.lg,
        background: color.fill,
        fontFamily: font.sans,
      }}
    >
      {activeMailboxEmail && (
        <div style={{ marginBottom: space[3] }}>
          <MailboxActionContextView mailboxEmail={activeMailboxEmail} />
        </div>
      )}
      <h3 style={{ ...tokens.typography.dialogTitle, margin: 0, color: color.fg }}>{headline}</h3>
      {explanation && <p style={{ ...mutedLine, textWrap: 'balance' }}>{explanation}</p>}

      {/* Why confirm is disabled while the live count is not a number (D211). */}
      {moves && effectiveCount === 'loading' && (
        <p style={mutedLine}>{WS5_COPY['f1.preview.backlog.loading']}</p>
      )}
      {moves && effectiveCount === 'unavailable' && (
        <div role="status">
          <p style={mutedLine}>{WS5_COPY['preview.state.loadFailed']}</p>
          {onRetryPreview && (
            <Button tone="ghost" onClick={onRetryPreview}>
              {WS2_COPY.home.failed.retry}
            </Button>
          )}
        </div>
      )}

      {scopeCopy && !noCurrentMail && (
        <p role="status" style={mutedLine}>
          {scopeCopy}
        </p>
      )}

      {!isCleanupAction && verb !== 'unsubscribe' && <p style={mutedLine}>{note}</p>}

      {isCleanupAction && (
        <div style={{ marginTop: space[3] }}>
          <CleanupPreview
            olderThanDays={windowDays}
            options={CLEANUP_AGE_OPTIONS}
            showWindow={onWindowChange !== undefined}
            onWindowChange={(days) => onWindowChange?.(days)}
          >
            {/* ADR-0028 reach — unchecked stays inbox-only. */}
            {verb === 'delete' && liveInboxNumber(inboxCount) != null && (
              <ActionReachControl
                value={activeReach}
                inboxCount={liveInboxNumber(inboxCount)}
                allMailCount={allMailCount}
                onChange={(next) => onReachChange?.(next)}
              />
            )}
          </CleanupPreview>
        </div>
      )}

      {verb === 'later' && onWakeAtChange && (
        <div style={{ marginTop: space[3] }}>
          <LaterReturnControl value={wakeAt ?? null} onChange={onWakeAtChange} />
        </div>
      )}
      {returnInvalid && (
        <p role="status" style={mutedLine}>
          {WS5_COPY['preview.later.returnInvalid']}
        </p>
      )}

      {/* Protected acknowledgement (D42/D245) — stated before the
          confirm, never after the fact. `role="status"` so a screen
          reader hears it when the preview opens. */}
      {overriding && (
        <p role="status" style={{ ...mutedLine, marginTop: space[3], color: color.fgSoft }}>
          <strong style={{ fontWeight: 600, color: color.dangerText }}>
            This sender is Protected
          </strong>{' '}
          because {screenerProtectionClause(row.protectionReason)}. It stays Protected.
        </p>
      )}

      {facts.length > 0 && (
        <Disclosure style={{ marginTop: space[2] }}>
          <SheetFactList facts={facts} />
        </Disclosure>
      )}

      {isCleanupAction && (
        <div style={{ marginTop: space[3] }}>
          <CleanupImpact
            action={verb === 'archive' ? 'Archive' : verb === 'later' ? 'Later' : 'Delete'}
            count={previewBlocked ? null : liveCount}
            includesArchived={allMailReach}
            olderThanDays={windowDays}
            note={note}
          />
        </div>
      )}

      {verb === 'unsubscribe' && (
        <div style={{ marginTop: space[3] }}>
          <UnsubscribeImpact
            mode="unsub_only"
            count={null}
            olderThanDays={null}
            note={WS5_COPY['f1.honesty.unsubOnly']}
          />
        </div>
      )}

      <div className="dm-confirm-footer" style={{ marginTop: space[3] }}>
        <Button size="md" tone="ghost" onClick={onCancel} disabled={confirming}>
          Cancel
        </Button>
        {noCurrentMail && onChooseDecision ? (
          <>
            {canScreenerUnsubscribe(row) && (
              <Button
                size="md"
                tone="ghost"
                onClick={() => onChooseDecision('unsubscribe')}
                disabled={confirming}
              >
                Unsubscribe
              </Button>
            )}
            <Button
              size="md"
              tone="primary"
              onClick={() => onChooseDecision('keep')}
              disabled={confirming}
            >
              Keep
            </Button>
          </>
        ) : (
          <Button
            size="md"
            tone={verb === 'delete' ? 'danger' : verb === 'unsubscribe' ? 'warn' : 'primary'}
            onClick={onConfirm}
            disabled={confirmDisabled}
            // Stable across the in-flight transition — a button that
            // renames itself mid-action loses its accessible identity — and
            // it contains the visible label (WCAG 2.5.3).
            ariaLabel={`${restingLabel} for ${name}`}
          >
            {confirmLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

const emailsLabel = (count: number) =>
  `${count.toLocaleString('en-US')} email${count === 1 ? '' : 's'}`;

/** Chip-count coercion — a not-yet-resolved live count renders no figure. */
function liveInboxNumber(count: DecidePreviewCount): number | null {
  return typeof count === 'number' ? count : null;
}
