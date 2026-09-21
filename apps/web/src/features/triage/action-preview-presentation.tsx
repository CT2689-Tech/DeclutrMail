import { tokens } from '@declutrmail/shared';
import { buildActionPresentation } from '@declutrmail/shared/actions';
import type { ActionReach } from '@declutrmail/shared/contracts';
import { scoredAgeLabel } from '@declutrmail/shared/copy';

import { useNow } from '@/lib/use-now';
import type { TriageDecisionRow } from './data';
import type { ActionVerb } from './types';

const { color, text } = tokens;

/**
 * The live "what moves" figure for the preview — the sender's
 * current-inbox count from `GET /api/actions/preview` (ADR-0020).
 * `loading` while the preview query is in flight; `unavailable` when
 * it failed. The owning confirm surface fails closed for mail-moving
 * verbs until this value is numeric.
 */
export type PreviewCount = number | 'loading' | 'unavailable';

export interface PreviewFactsInput {
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
  /** Exact Later return time carried by the pending action. */
  wakeAt?: string | null | undefined;
  /**
   * ADR-0028 — the reach a Delete preview is armed at; `inboxCount` is
   * then the count AT that reach. Absent = `inbox_only`.
   */
  reach?: ActionReach | undefined;
}

/**
 * What a preview says, as data (D208, D226, ADR-0042).
 *
 * A preview owes the user three things, each ONCE: the count (`title`),
 * where the email goes (`subtitle`), how to undo it (`note`). Everything
 * else the product knows is a `disclosure` and lives behind "Details".
 * The sheet and the inline (D34 skip-sheet) preview both read this, so
 * the two cannot drift.
 *
 * Every sentence is either composed from a field passed in, or comes from
 * the shared action semantics (`buildActionPresentation`) — the undo
 * window, the Gmail Trash retention, the unsubscribe channel and the
 * Later schedule are never restated by hand here.
 */
export interface PreviewFacts {
  /** The verb moves mail right now (Unsubscribe only with the backlog on). */
  counts: boolean;
  /** Numeric live count, or null while loading / unavailable. */
  liveCount: number | null;
  /** A count-based verb whose live count resolved to zero. */
  nothingToMove: boolean;
  allMail: boolean;
  title: string;
  subtitle: string | null;
  note: string | null;
  /** Count + destination in one line, for the inline preview. */
  compactLine: string;
  /** Confirm label — verb + count when the count is known. */
  primaryLabel: string;
  /** Collapsed facts, in reading order. */
  disclosures: readonly string[];
  /** Cleanup actions this confirm spends (metered tiers). */
  unitsNeeded: number;
}

const n = (value: number) => value.toLocaleString('en-US');
const emails = (count: number) => `${n(count)} email${count === 1 ? '' : 's'}`;

export function buildPreviewFacts({
  verb,
  row,
  archiveHistoric,
  inboxCount,
  wakeAt = null,
  reach = 'inbox_only',
}: PreviewFactsInput): PreviewFacts {
  const subject = row.senderName;
  const actionVerb = verb.toLowerCase() as 'keep' | 'archive' | 'unsubscribe' | 'later' | 'delete';
  const liveCount = typeof inboxCount === 'number' ? inboxCount : null;
  // Only Delete may act past the inbox; any other verb ignores the prop.
  const allMail = verb === 'Delete' && reach === 'all_mail';
  const presentation = buildActionPresentation({
    verb: actionVerb,
    liveCount: actionVerb === 'keep' || actionVerb === 'unsubscribe' ? 0 : liveCount,
    planUndoDeadline: null,
    wakeAt: actionVerb === 'later' ? wakeAt : null,
    unsubscribeChannel: actionVerb === 'unsubscribe' ? row.unsubscribeMethod : null,
    // Absolute times render in the reader's own clock: every one of
    // these surfaces is opened by a click, never server-rendered.
    timeZone: 'viewer',
    secondaryAction:
      actionVerb === 'unsubscribe' && archiveHistoric ? { verb: 'archive', liveCount } : null,
    reach: allMail ? 'all_mail' : 'inbox_only',
  });
  const { primary, secondary } = presentation;

  // Archive/Later/Delete act on the sender's current inbox mail via the
  // worker; Unsubscribe only when the backlog toggle is on; Keep never.
  const movesCurrentInbox = verb === 'Archive' || verb === 'Later' || verb === 'Delete';
  const counts = movesCurrentInbox || (verb === 'Unsubscribe' && archiveHistoric);
  // QA-delete-20260829-08 — a header that promises a move read as active
  // even when the live count is 0. Only the count-based verbs can BE zero
  // this way; Unsubscribe and Keep never claim a mail move.
  const nothingToMove = movesCurrentInbox && liveCount === 0;

  const title = nothingToMove
    ? `Nothing in your inbox${allMail ? ' or archive' : ''} from ${subject}`
    : verb === 'Archive'
      ? liveCount === null
        ? `Archive email from ${subject}?`
        : `Archive ${emails(liveCount)}?`
      : verb === 'Delete'
        ? liveCount === null
          ? `Delete email from ${subject}?`
          : `Delete ${emails(liveCount)}?`
        : verb === 'Later'
          ? liveCount === null
            ? `Move email from ${subject} to Later?`
            : `Move ${emails(liveCount)} to Later?`
          : verb === 'Unsubscribe'
            ? `Unsubscribe from ${subject}?`
            : `Keep ${subject}?`;

  const destination =
    verb === 'Archive'
      ? 'They leave your inbox and stay in Gmail.'
      : verb === 'Delete'
        ? allMail
          ? 'Inbox and archived email both move to Gmail Trash.'
          : 'They move to Gmail Trash.'
        : verb === 'Later'
          ? 'They wait in Gmail’s DeclutrMail/Later label, then return to your inbox.'
          : null;
  const subtitle = nothingToMove
    ? null
    : verb === 'Unsubscribe'
      ? primary.unsubscribeChannel.kind === 'not-applicable' ||
        primary.unsubscribeChannel.kind === 'varies'
        ? primary.futureMail.summary
        : primary.unsubscribeChannel.summary
      : destination === null
        ? primary.currentMail.summary
        : `From ${subject}. ${destination}`;

  // How to undo it — or the one thing that cannot be undone. Zero
  // matches: nothing can run, so there is nothing to undo.
  const note = nothingToMove
    ? null
    : verb === 'Unsubscribe'
      ? `A sent unsubscribe can’t be recalled.${
          archiveHistoric ? ' The archived email can be undone from Activity.' : ''
        }`
      : [
          primary.activityUndo.summary,
          // Delete is the one verb where the reader plausibly fears the
          // opposite (CLAUDE.md §2.3).
          ...(verb === 'Delete' && primary.futureMail.inPreview
            ? [primary.futureMail.summary]
            : []),
          ...(primary.bulkReturnNotice === null ? [] : [primary.bulkReturnNotice]),
        ].join(' ');

  const compactLine = nothingToMove
    ? title
    : verb === 'Unsubscribe'
      ? (subtitle ?? title)
      : `${liveCount === null ? 'Email' : emails(liveCount)} from ${subject}. ${destination ?? ''}`.trim();

  const disclosures: string[] = [];
  if (counts && liveCount !== null) {
    disclosures.push(
      `Counted ${allMail ? 'across inbox + archived' : 'in Inbox'} now. Rechecked when it runs.`,
    );
  }
  // "from", a floor rather than a delivery time — see `presentationSchedule`.
  if (primary.schedule.kind === 'scheduled') disclosures.push(primary.schedule.summary);
  if (verb === 'Unsubscribe') {
    disclosures.push(primary.currentMail.summary);
    if (secondary !== null) {
      disclosures.push(secondary.currentMail.summary, secondary.activityUndo.summary);
    }
  }
  if (primary.providerRecovery.kind !== 'none') {
    disclosures.push(primary.providerRecovery.summary);
  }

  return {
    counts,
    liveCount,
    nothingToMove,
    allMail,
    title,
    subtitle,
    note,
    compactLine,
    primaryLabel:
      counts && liveCount !== null && liveCount > 0 && verb !== 'Unsubscribe'
        ? `${verb} ${n(liveCount)}`
        : verb,
    disclosures,
    // The server charges a second unit for a backlog verb riding an
    // Unsubscribe (`recordUnsubIntent` preflights `includesBacklogAction
    // ? 2 : 1`, and the paired Archive enqueues as its own action).
    unitsNeeded: 1 + (verb === 'Unsubscribe' && archiveHistoric ? 1 : 0),
  };
}

/** "Uses 1 of your 34 cleanup actions left this month." — metered tiers only. */
export function cleanupCostLine(
  unitsNeeded: number,
  quotaRemaining: number | null | undefined,
): string | null {
  if (quotaRemaining == null) return null;
  return `Uses ${n(unitsNeeded)} of your ${n(quotaRemaining)} cleanup action${
    quotaRemaining === 1 ? '' : 's'
  } left this month.`;
}

/**
 * The engine's "why this verdict" copy, with how old that read is.
 *
 * `useNow`, not an ambient `new Date()` — same hydration reasoning as
 * `TriageRowExpanded` (D25, founder 2026-08-19): the reasoning sentence
 * freezes at score time while the count beside it is live
 * (QA-archive-20260828-02).
 */
export function PreviewReasoning({ row }: { row: TriageDecisionRow }) {
  const now = useNow();
  const ageLabel =
    row.scoredAt !== undefined && now !== null ? scoredAgeLabel(row.scoredAt, new Date(now)) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          fontSize: text.xs,
          color: color.fgMuted,
        }}
      >
        <span>Why we suggested this</span>
        {ageLabel !== null && <span style={{ whiteSpace: 'nowrap' }}>{ageLabel}</span>}
      </span>
      <span style={{ color: color.fg }}>{row.reasoning}</span>
    </div>
  );
}
