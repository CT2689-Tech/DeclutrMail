'use client';

import {
  Button,
  SheetFactList,
  SheetSegmented,
  tokens,
  type SheetFactItem,
} from '@declutrmail/shared';
import {
  buildActionPresentation,
  describeInboxScope,
  inboxScopeNoticeCopy,
  WINDOW_PRESET_LABELS,
} from '@declutrmail/shared/actions';
import { scoredAgeLabel } from '@declutrmail/shared/copy';
import { getActiveMailboxEmail, useOptionalAuth } from '@/features/auth/auth-provider';
import { afterLead } from '@/lib/copy/after-lead';
import { useNow } from '@/lib/use-now';
import type { ActionReach } from '@/lib/api/actions';

import {
  needsProtectedOverride,
  screenerProtectionClause,
  type ScreenerDecideVerb,
  type ScreenerQueueRow,
} from './data';
import { VERB_LABEL } from './verbs';

const { color, font, radius, space, text } = tokens;

/**
 * Live impact figure — the sender's current-inbox count from
 * `GET /api/actions/preview` (never a client estimate, D226).
 */
export type DecidePreviewCount = number | 'loading' | 'unavailable';

/**
 * The mandatory pre-mutation preview for a Screener decision (D226).
 *
 * Mounts inline inside the expanded row when a verb is pending, in the
 * compact grammar of Triage's `InlinePreviewBlock` (ADR-0042): one bold
 * line with the count and where the email goes, one muted line for how to
 * undo it, only the controls that change the count, everything else
 * behind "Details", then the confirm. Confirm dispatches the decision;
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
  inboxTotal = null,
  windowDays = null,
  allMailCount = null,
  allMailTotal = null,
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
   * QA-delete-20260829-01 — the TRUE un-windowed inbox count
   * (`counts.all`), for the empty-window reconciliation notice.
   * `null` while the preview hasn't resolved.
   */
  inboxTotal?: number | null;
  /**
   * QA-delete-20260829-01 — the day-window currently applied to
   * `inboxCount`, if any (Delete defaults to `DEFAULT_DELETE_WINDOW_DAYS`;
   * every other verb passes `null` — no window, acts on the whole inbox).
   */
  windowDays?: number | null;
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
  // What actually moves — only the label-modify verbs touch the inbox.
  // Declared before `title` (QA-delete-20260903-01): a zero-match Archive/
  // Later/Delete needs to say so in the header, the same "Nothing to move"
  // branch `action-preview-presentation.tsx` already has for Triage.
  const moves = verb === 'archive' || verb === 'later' || verb === 'delete';
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
  const headline = zero
    ? `Nothing to move from ${name} right now`
    : verb === 'keep'
      ? `Keep ${name}. No email moves.`
      : verb === 'unsubscribe'
        ? `Unsubscribe from ${name}. ${
            primary.unsubscribeChannel.kind === 'not-applicable' ||
            primary.unsubscribeChannel.kind === 'varies'
              ? primary.futureMail.summary
              : primary.unsubscribeChannel.summary
          }`
        : `${liveCount === null ? 'Email' : emailsLabel(liveCount)} from ${name}. ${destination ?? ''}`.trim();

  // ── One muted line: how to undo it ──────────────────────────────────
  // Zero matches: nothing moves, but Confirm is still live — it resolves
  // the quarantine row (`ScreenerService.decide` sets `decided_at` even on
  // a 0-message enqueue), so the sender leaves this queue. Say that; a
  // live button over "Nothing to move" otherwise reads as a no-op.
  const note = zero
    ? `Confirming records your decision and removes ${name} from the Screener.`
    : [
        primary.activityUndo.summary,
        // Delete is the one verb where the reader plausibly fears the
        // opposite (CLAUDE.md §2.3).
        ...(verb === 'delete' && primary.futureMail.inPreview ? [primary.futureMail.summary] : []),
        ...(primary.bulkReturnNotice === null ? [] : [primary.bulkReturnNotice]),
      ].join(' ');

  const auth = useOptionalAuth();
  const activeMailboxEmail = mailboxEmail ?? (auth ? getActiveMailboxEmail(auth.me) : null);

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
  const scopeCopy =
    moves && typeof effectiveCount === 'number' && !allMailReach
      ? inboxScopeNoticeCopy(
          describeInboxScope({
            inboxTotal: inboxTotal ?? effectiveCount,
            windowCount: effectiveCount,
            olderThanDays: windowDays,
            recentArrivals: null,
          }),
          VERB_LABEL[verb],
          'this sender',
          { verbActsBeyondInbox: reachAvailable },
        )
      : null;
  // Same "(older than N)" qualifier the senders confirm modal renders
  // beside its own live count when a window is active.
  const windowQualifier =
    !allMailReach && windowDays !== null
      ? ` (older than ${WINDOW_PRESET_LABELS[windowDays] ?? `${windowDays} days`})`
      : '';

  // ── Details ─────────────────────────────────────────────────────────
  const facts: SheetFactItem[] = [];
  if (activeMailboxEmail) {
    facts.push({
      label: 'Gmail account',
      value: (
        <span role="note" aria-label={`Gmail account: ${activeMailboxEmail}`}>
          {activeMailboxEmail}
        </span>
      ),
    });
  }
  if (moves && liveCount !== null) {
    facts.push({
      label: 'Count',
      value: `${allMailReach ? 'Inbox + archived' : 'Inbox'} now${windowQualifier}, rechecked when it runs`,
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
  if (verb === 'unsubscribe') {
    facts.push({ label: 'Past email', value: 'Stays where it is' });
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
      label: 'Gmail Trash',
      value: `Kept up to ${primary.providerRecovery.approximateDays} days, then deleted for good`,
    });
  }
  // Engine recap — why the engine queued this sender, and how old that
  // read is (QA-archive-20260903-01).
  if (row.recommendation != null) {
    facts.push({
      label: 'Why suggested',
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
      <p style={{ margin: 0, fontSize: text.md, fontWeight: 600, color: color.fg }}>{headline}</p>

      {/* Why confirm is disabled while the live count is not a number (D211). */}
      {moves && effectiveCount === 'loading' && <p style={mutedLine}>Counting the inbox…</p>}
      {moves && effectiveCount === 'unavailable' && (
        <p style={mutedLine}>Couldn’t load the preview. Nothing can move until it loads.</p>
      )}

      {scopeCopy && (
        <p role="status" style={mutedLine}>
          {scopeCopy}
        </p>
      )}

      <p style={mutedLine}>{note}</p>

      {/* ADR-0028 reach — Delete only. The options carry the live counts
          so "Inbox + archived" is discoverable exactly when the inbox
          count reads low. */}
      {reachAvailable && (
        <div style={{ marginTop: space[3] }}>
          <SheetSegmented
            label="Where it applies"
            value={activeReach}
            onChange={(next) => onReachChange?.(next)}
            options={[
              {
                value: 'inbox_only',
                label: 'Inbox only',
                count: liveInboxNumber(inboxCount) ?? undefined,
              },
              { value: 'all_mail', label: 'Inbox + archived', count: allMailCount ?? undefined },
            ]}
          />
        </div>
      )}

      {/* Protected acknowledgement (D42/D245) — stated before the
          confirm, never after the fact. `role="status"` so a screen
          reader hears it when the preview opens. */}
      {overriding && (
        <p role="status" style={{ ...mutedLine, marginTop: space[3], color: color.fgSoft }}>
          <strong style={{ fontWeight: 600, color: color.danger }}>This sender is Protected</strong>{' '}
          because {screenerProtectionClause(row.protectionReason)}. Confirming acts on it anyway; it
          stays Protected.
        </p>
      )}

      {facts.length > 0 && (
        <details style={{ marginTop: space[2] }}>
          <summary
            style={{ cursor: 'pointer', fontSize: text.sm, fontWeight: 550, color: color.fgSoft }}
          >
            Details
          </summary>
          <div style={{ marginTop: space[2], fontSize: text.sm, color: color.fg }}>
            <SheetFactList facts={facts} />
          </div>
        </details>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: space[2], marginTop: space[3] }}>
        <Button
          size="md"
          tone={verb === 'delete' ? 'danger' : verb === 'unsubscribe' ? 'warn' : 'primary'}
          onClick={onConfirm}
          disabled={confirmDisabled}
          // Stable across the in-flight transition — a button that
          // renames itself mid-action loses its accessible identity.
          ariaLabel={`Confirm ${VERB_LABEL[verb]}${overriding ? ' anyway' : ''} for ${name}`}
        >
          {confirmLabel}
        </Button>
        <Button size="md" tone="ghost" onClick={onCancel} disabled={confirming}>
          Cancel
        </Button>
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
