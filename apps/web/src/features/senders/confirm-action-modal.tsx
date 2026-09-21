'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Avatar,
  Button,
  PreviewSheet,
  SheetFactList,
  SheetLinks,
  SheetSegmented,
  SheetTextAction,
  tokens,
  type SheetFactItem,
} from '@declutrmail/shared';
import { normalizeProtectionReason, protectionReasonClause } from '@declutrmail/shared/copy';
import {
  buildActionPresentation,
  countUnsubscribeCapabilities,
  DEFAULT_DELETE_WINDOW_DAYS,
  defaultLaterWakeAtIso,
  describeInboxScope,
  inboxScopeNoticeCopy,
  mailLocationCopy,
  tiedWindowNoticeCopy,
  UNSUBSCRIBE_CAPABILITIES,
  type UnsubscribeChannel,
} from '@declutrmail/shared/actions';
import { getActiveMailboxEmail, useOptionalAuth } from '@/features/auth/auth-provider';
import { mailLocationValue } from '@/features/triage/action-preview-detail';
import { afterLead } from '@/lib/copy/after-lead';
import { GmailOpenLinkService } from '@/lib/gmail/open-link';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import { useUpgradeGateStore } from '@/lib/entitlements/upgrade-gate';
import type {
  BulkActionPreviewResult,
  CompositeActionPreviewResult,
  CompositePreviewMessage,
} from '@/lib/api/use-action';
import type { ActionReach } from '@/lib/api/actions';
import {
  isStandingProtected,
  shortDate,
  verbDisplay,
  type ActionRequest,
  type ActionVerb,
  type Sender,
} from './data';

const { color, font, radius, space, text } = tokens;

/**
 * Composite secondary verb (spec v1.2 Decision 15). Picked from the
 * "ALSO ACT ON PAST EMAILS" chip row on Unsubscribe + Later primary.
 * `null` = "Leave alone" (the default — no secondary action fires).
 */
export type ConfirmSecondaryVerb = 'archive' | 'delete' | null;

export interface ConfirmOptions {
  /**
   * Explicit acknowledgement that the target sender is Protected. Set
   * only on a single-sender request; the server requires it to act on a
   * protected sender and otherwise answers 409 PROTECTED_SENDER (D42).
   * Bulk never sets it — D245 excludes protected senders from bulk.
   */
  override?: boolean;
  /** Exact return time confirmed for a Later action. */
  wakeAt?: string;
  /**
   * Time-window filter for the PRIMARY verb (Archive primary, Delete
   * primary, or the secondary historic action on Unsub/Later when its
   * own window is not set). `null` = no filter, act on all matching
   * mail. Spec v1.2 Decision 15 chips: All / 30d+ / 3mo+ / 6mo+ / 1yr+.
   */
  olderThanDays?: number | null;
  /**
   * Composite secondary (ADR-0020). Applies only when primary ∈
   * {Unsubscribe, Later}. `null` / omitted = "Leave alone" — no
   * secondary action fires. Carries its own time-window so the user
   * can say "Unsubscribe + Delete past 6 months" with one click.
   */
  secondary?: {
    type: 'archive' | 'delete';
    olderThanDays?: number | null;
  } | null;
  /**
   * @deprecated Pre-spec-v1.2 boolean toggle preserved for tracer
   * surfaces (review-session apply). New callers should populate
   * `secondary` directly. The modal derives this from `secondary` so
   * legacy consumers continue to receive a truthy value when the user
   * picks "Archive them".
   */
  archiveHistoric?: boolean;
  /**
   * ADR-0028 — set to `all_mail` when the user chose "Inbox + archived"
   * on a single-sender Delete, or on an Unsubscribe's "Delete them"
   * secondary. Omitted otherwise (the wire default is inbox-only, and
   * the server rejects the value on any other shape). The caller applies
   * this to whichever call is the actual Delete primary on the wire —
   * for the composite secondary that is the re-dispatched historic
   * action, not the unsubscribe-intent call.
   */
  reach?: ActionReach;
}

/**
 * Time-window presets (spec v1.2 Decision 15). Days values plumb to the
 * BE `olderThanDays` filter; the label is what the user reads. `null`
 * value = no time filter (act on all). Defaults per verb (handoff spec):
 *   - Archive primary → null    ("All inbox")
 *   - Delete primary  → 180     ("6 months+" — safer)
 *   - Unsub/Later secondary historic → null when first toggled on
 */
const TIME_WINDOW_PRESETS = [
  { label: 'All inbox', days: null as number | null },
  { label: '30 days+', days: 30 },
  { label: '3 months+', days: 90 },
  { label: '6 months+', days: 180 },
  { label: '1 year+', days: 365 },
] as const;

/**
 * Aggregated multi-sender preview state (D52). Drives the chip-row
 * bucket counts, the headline figure, and the per-sender breakdown for
 * a bulk action. `loading` gates confirm exactly like the single-sender
 * preview; `error` blocks Delete confirm (D226 preview mandate).
 */
export interface BulkPreviewState {
  data: BulkActionPreviewResult | undefined;
  loading: boolean;
  error: boolean;
}

/**
 * Pick the right bucket count from the composite preview for a given
 * `olderThanDays`. Keeps the summary line + confirm button in step with
 * the active chip without a round-trip per chip.
 */
function pickBucketCount(
  counts: CompositeActionPreviewResult['counts'] | undefined,
  olderThanDays: number | null,
): number | undefined {
  if (!counts) return undefined;
  if (olderThanDays === null) return counts.all;
  if (olderThanDays === 30) return counts.olderThan30d;
  if (olderThanDays === 90) return counts.olderThan90d;
  if (olderThanDays === 180) return counts.olderThan180d;
  if (olderThanDays === 365) return counts.olderThan365d;
  // Custom value (post-launch) — fall back to `all` until the
  // server-side on-demand bucket query lands (Phase 1 BE PR-N polish).
  return counts.all;
}

/**
 * Mirror of `pickBucketCount` for the "Show what currently matches" recent-
 * subjects panel (spec v1.3 — recent beats oldest for 3-sec sender
 * recognition). Returns the BE-returned top-5 subjects for the chip
 * the user has selected; `undefined` while the preview is in flight
 * (the disclosure renders nothing until real data lands — §10).
 */
function pickBucketSubjects(
  buckets: CompositeActionPreviewResult['recentMessages'] | undefined,
  olderThanDays: number | null,
): CompositePreviewMessage[] | undefined {
  if (!buckets) return undefined;
  if (olderThanDays === null) return buckets.all;
  if (olderThanDays === 30) return buckets.olderThan30d;
  if (olderThanDays === 90) return buckets.olderThan90d;
  if (olderThanDays === 180) return buckets.olderThan180d;
  if (olderThanDays === 365) return buckets.olderThan365d;
  return buckets.all;
}

/** Default time-window per primary verb (spec v1.2 Decision 15 table). */
function defaultWindow(verb: ActionVerb): number | null {
  return verb === 'Delete' ? DEFAULT_DELETE_WINDOW_DAYS : null;
}

/**
 * The mandatory action preview (D226). No bulk mutation runs without
 * this confirm — it states the current match count before anything
 * happens. Gmail is resolved again by the worker at execution.
 *
 * Layout is the shared `PreviewSheet` (ADR-0042), in the same grammar as
 * Triage's `ActionSheet`: the count in the title, where the email goes in
 * the subtitle, how to undo it in the note — each once — only the
 * controls that change the count in the body, and every other fact
 * behind "Details".
 */
export function ConfirmActionModal({
  request,
  onCancel,
  onConfirm,
  compositePreview,
  compositePreviewLoading,
  compositePreviewError,
  bulkPreview,
  submitting = false,
  onRetryPreview,
  previewSenderGone = false,
  onRefreshSenders,
  mailboxEmail,
  cleanupQuota,
}: {
  request: ActionRequest | null;
  onCancel: () => void;
  onConfirm: (opts: ConfirmOptions) => void;
  /**
   * D54 (ADR-0018) — phone-width callers pass 'sheet'. Kept for the
   * call-site contract only: `PreviewSheet` is a centred dialog on desktop
   * and a bottom sheet on phones in pure CSS, so both values render the
   * same surface and the D226 content and gating never differed anyway.
   */
  variant?: 'modal' | 'sheet';
  /**
   * Composite preview (ADR-0020). Drives the sender context strip's real
   * domain/monthly/lastSeenDays values + the per-bucket counts the chip
   * row displays. Single-sender path only — absent for bulk flows.
   */
  compositePreview?: CompositeActionPreviewResult | undefined;
  /** Composite preview is still resolving; confirmation remains unavailable. */
  compositePreviewLoading?: boolean | undefined;
  /**
   * Composite-preview fetch error — surfaces when the BE preview call
   * failed. Any action that moves existing mail MUST disable confirm so
   * the user cannot proceed past D226's preview mandate (silent-failure-hunter
   * 2026-06-05: a sustained 5xx during composite preview left confirm
   * enabled with `compositeCount === undefined`).
   */
  compositePreviewError?: boolean | undefined;
  /**
   * Aggregated multi-sender preview (D52). Present only for bulk
   * (>1 sender) flows — supplies the chip-row bucket totals, the
   * headline figure, and the per-sender breakdown list.
   */
  bulkPreview?: BulkPreviewState | undefined;
  /**
   * The confirmed request is on its way to the server. The modal stays
   * up, the button says so, and nothing can be confirmed twice. Cancel,
   * Esc and the backdrop stay LIVE — they close the UI only, so a request
   * that hangs can never seal the user inside the overlay; if it lands,
   * the rows report it. It used to close BEFORE the request was sent.
   */
  submitting?: boolean;
  /** Re-run the live preview after a failed read. */
  onRetryPreview?: (() => void) | undefined;
  /**
   * The preview failed with `SENDER_NOT_FOUND` — this sender id no
   * longer resolves in the active mailbox. Distinct from a transient
   * failure because retrying the SAME id can never succeed, and a
   * button that cannot work is worse than no button: it reads as the
   * app being broken rather than the list being stale.
   */
  previewSenderGone?: boolean | undefined;
  /** Refetch the senders list and dismiss — the only exit from `previewSenderGone`. */
  onRefreshSenders?: (() => void) | undefined;
  /**
   * A3 — the workspace's cleanup-quota position from `useTier()`.
   * `remaining: null` = unlimited (no quota line). The SERVER stays the
   * final authority: stale client state that wrongly says "fits" gets
   * the honest 402 → upgrade modal on confirm.
   */
  cleanupQuota?: { remaining: number | null; resetsAt: string | null } | undefined;
  /** Explicit override for isolated previews; app surfaces use active auth context. */
  mailboxEmail?: string | undefined;
}) {
  const verb = request?.verb;
  // Composite secondary (chip row) — applies only on Unsubscribe + Later
  // primary. `null` = "Leave alone" (the default — keeps the modal
  // non-destructive for first-time openers).
  const [secondaryVerb, setSecondaryVerb] = useState<ConfirmSecondaryVerb>(null);
  // Time-window filter for the historic-scope verb (archive/delete
  // primary OR the active secondary).
  const [olderThanDays, setOlderThanDays] = useState<number | null>(null);
  // ADR-0028 reach — Delete-only chip pair (Inbox only / Inbox +
  // archived). Always reset to the safe default on open.
  const [reach, setReach] = useState<ActionReach>('inbox_only');
  const [wakeAt, setWakeAt] = useState<string | null>(null);
  // "Show what currently matches" expand panel state (spec v1.2 Decision 15).
  const [showSubjects, setShowSubjects] = useState(false);
  // Per-sender breakdown expand state (D52 — "Per-sender breakdown"
  // expandable list for verification on bulk flows).
  const [showAllSenders, setShowAllSenders] = useState(false);

  useEffect(() => {
    if (!request) return;
    setSecondaryVerb(null);
    setOlderThanDays(defaultWindow(request.verb));
    setReach('inbox_only');
    setWakeAt(request.verb === 'Later' ? defaultLaterWakeAtIso() : null);
    setShowSubjects(false);
    setShowAllSenders(false);
  }, [request]);

  // The historic-bucket count for the current chip selection — used by
  // the summary line + "Show what currently matches" header.
  const isArchiveVerb = verb === 'Archive';
  const isDeleteVerb = verb === 'Delete';
  const isUnsubVerb = verb === 'Unsubscribe';
  const isLaterVerb = verb === 'Later';
  // Every A/L/D primary moves current inbox mail. Archive/Delete expose a
  // primary time-window; Later keeps its existing all-current-mail shape.
  const primaryActsOnInbox = isArchiveVerb || isLaterVerb || isDeleteVerb;
  const primaryUsesWindow = isArchiveVerb || isDeleteVerb;
  // Whether the secondary chip row is shown. Unsubscribe ONLY: it is the
  // one primary that does not touch existing inbox mail, so "what about
  // the backlog?" is a real, unanswered question. Later already moves
  // every current message out of the inbox and schedules its return, so
  // pairing it with "also archive/delete the past" asked the user to
  // choose between two mutually-exclusive fates for the same mail.
  const showSecondaryRow = isUnsubVerb;
  const hasSecondaryAction = showSecondaryRow && secondaryVerb !== null;
  /** Unsubscribe with the backlog left alone — nothing in Gmail moves. */
  const unsubscribeMovesNothing = isUnsubVerb && !hasSecondaryAction;

  // For Archive/Delete primary the time-window applies to the primary
  // verb itself. For Unsubscribe with a non-null secondary, the
  // time-window applies to the secondary's historic mail.
  const showWindowRow = primaryUsesWindow || hasSecondaryAction;

  // Multi-sender bulk (D52) — the aggregated preview replaces the
  // single-sender composite preview as the bucket-count source. The
  // confirm-gating rules below are IDENTICAL across both shapes.
  const isBulk = (request?.senders.length ?? 0) > 1;

  // The two reaches' bucket counts, from whichever preview this flow
  // runs on — the single-sender composite or the bulk aggregate (whose
  // totals already exclude Protected senders, like its enqueue).
  const inboxCounts = isBulk ? bulkPreview?.data?.totals : compositePreview?.counts;
  const allMailCounts = isBulk
    ? bulkPreview?.data?.allMailTotals
    : compositePreview?.allMail?.counts;

  // ADR-0028 reach. Offered only where the server accepts it — a
  // Delete, whether it is the primary verb or the Unsubscribe
  // composite's "Delete them" secondary (2026-08-31 amendment: the
  // secondary re-dispatches as its own Delete primary, which already
  // accepts `reach`), for one sender or a bulk selection (2026-09-19
  // amendment: the `senders` fan-out persists the reach on every
  // per-sender row). And only when the preview actually carries the
  // all-mail block — it is absent against an API predating the field,
  // so during a deploy skew the choice simply does not appear.
  const reachAvailable =
    (isDeleteVerb || (hasSecondaryAction && secondaryVerb === 'delete')) && allMailCounts != null;
  const activeReach: ActionReach = reachAvailable ? reach : 'inbox_only';

  const bucketCounts = activeReach === 'all_mail' ? allMailCounts : inboxCounts;

  // A protected sender acted on EXPLICITLY, one at a time. D245 excludes
  // Protected from bulk and automatic actions only, so this path stays
  // open — but the server answers it with 409 PROTECTED_SENDER unless
  // `override` is set, and its message is written as a confirm ("Confirm
  // to archive anyway"). This is the "anyway" the server was waiting
  // for: we name the protection, and the confirm carries the override.
  // Bulk never overrides — protected senders are excluded upstream.
  const protectedSingle =
    !isBulk && request != null && request.senders[0] != null
      ? isStandingProtected(request.senders[0])
      : false;
  const needsProtectedOverride = protectedSingle && verb !== 'Keep';
  // D245: show the exact reason when the wire carries one this build knows.
  const protectedReason = normalizeProtectionReason(
    request?.senders[0]?.protectionFlags.protectionReason,
  );

  // D248 — a selection's unsubscribe capability is a PARTITION over four
  // states, never one aggregate. Only `one_click` senders are ones
  // DeclutrMail can unsubscribe; `mailto` stays user-sent (D230),
  // `none` has nothing to send, and `unknown` has not been checked yet.
  // Reported separately because they are different facts, and only one
  // of them is something the user can act on.
  const unsubCapabilities = isUnsubVerb
    ? countUnsubscribeCapabilities((request?.senders ?? []).map((s) => s.unsubscribeMethod))
    : null;
  // "If a selection contains zero one_click senders, the BATCH control
  // does not offer itself" — there is no request the fan-out can send.
  //
  // Scoped to bulk on purpose. At n=1 this modal is also the mandatory
  // preview for the single-sender flow, and that flow is the ONLY path
  // that produces D230's compose hand-off: the intent route answers
  // `mailto` with an address and the screen opens `UnsubMailtoCallout`.
  // Gating n=1 on "one-click or nothing" would disable confirm for a
  // mailto sender whose row control correctly invited the user in, and
  // tell them no channel exists when one does.
  const unsubNothingToSend =
    isBulk && unsubCapabilities !== null && unsubCapabilities.one_click === 0;
  // The lead describes the action that WILL run, i.e. the one-click
  // subset; the breakdown beneath it names everyone it will not touch.
  // With no one-click sender the lead falls back to the sole remaining
  // state (null when several are present — the breakdown speaks then).
  const unsubscribeChannel: UnsubscribeChannel | null = (() => {
    if (unsubCapabilities === null) return null;
    if (unsubCapabilities.one_click > 0) return 'one_click';
    const present = UNSUBSCRIBE_CAPABILITIES.filter((state) => unsubCapabilities[state] > 0);
    return present.length === 1 ? (present[0] ?? null) : null;
  })();

  // Fail closed on every path that moves current mail. A count from the
  // composite/bulk endpoint is the preview contract for the active time
  // window; all-labels received sender totals and a legacy all-inbox count
  // are not a
  // substitute. Pure single-sender Unsubscribe (Leave alone) is the one
  // exception because it does not move existing inbox mail and needs no
  // count to be valid.
  //
  // Codex review 2026-09-03 round 3: bulk Unsubscribe is NOT exempt —
  // unlike the single-sender mailto/compose path, it commits to a set of
  // sender IDS whose Protected/deleted status the live bulk preview is
  // the only source of truth for (`nothingActionableBulk` below). Without
  // `requiresLivePreview` covering it, confirm was reachable the instant
  // the modal opened, before that preview had even started, let alone
  // resolved — the stale queue count armed the click.
  const requiresLivePreview =
    isArchiveVerb || isLaterVerb || isDeleteVerb || hasSecondaryAction || (isBulk && isUnsubVerb);
  const livePreviewUnavailable =
    requiresLivePreview &&
    (isBulk
      ? bulkPreview == null || (bulkPreview.error ?? false)
      : (compositePreviewError ?? false));
  // A fetch in flight blocks readiness even when cached data is already
  // on screen: staleTime 0 + the default gcTime means a reopened modal
  // receives the PREVIOUS preview while the fresh one resolves, and a
  // cached count must never arm a mutation (D226).
  const livePreviewRefetching = isBulk
    ? (bulkPreview?.loading ?? false)
    : Boolean(compositePreviewLoading);
  const livePreviewReady =
    requiresLivePreview &&
    !livePreviewUnavailable &&
    !livePreviewRefetching &&
    (isBulk ? bulkPreview?.data !== undefined : compositePreview !== undefined);
  const livePreviewLoading = requiresLivePreview && !livePreviewUnavailable && !livePreviewReady;
  const livePreviewBlocksConfirm =
    requiresLivePreview && (livePreviewLoading || livePreviewUnavailable);
  const previewStateCopy = livePreviewUnavailable
    ? previewSenderGone
      ? 'This sender is no longer in this mailbox. Close and refresh.'
      : "Couldn't load the preview — nothing can run without one."
    : livePreviewLoading
      ? 'Loading preview…'
      : null;

  // Preview bucket count under the current chip selection — the ONE
  // count source: it feeds the headline, the zero-state gate and (via
  // requestedCount parity server-side) what the worker will move.
  const compositeCount = pickBucketCount(bucketCounts, olderThanDays);

  // A verb whose ENTIRE effect is moving inbox mail is a pure no-op when
  // the selected window matches nothing → block confirm. Gated on the
  // SAME count the headline renders, so "0 emails currently match" can
  // never sit above an enabled confirm (finding 5.5).
  //
  // `primaryActsOnInbox`, not just Archive/Delete: Later is the third
  // verb with no effect outside the current inbox (`ACTION_SEMANTICS.later`
  // — `futureMail.effect: 'unchanged'`, no policy delta), so confirming it
  // on an empty inbox enqueued a job, wrote an Activity row and rendered a
  // receipt for moving nothing — while the footer claimed "Uses 1 of your
  // N cleanup actions", which is not even true of a no-op
  // (`EntitlementsService.cleanupUnitsUsed` excludes
  // `status = 'done' AND affected_count = 0`). Unsubscribe is deliberately
  // excluded — it cuts FUTURE mail, so it is real work at a zero backlog,
  // and it IS charged a unit.
  const nothingToActOn = primaryActsOnInbox && compositeCount === 0;
  const wakeAtInvalid = isLaterVerb && (wakeAt === null || Date.parse(wakeAt) <= Date.now());

  // Reconcile the two ORTHOGONAL populations this modal renders at once:
  // the context strip's arrival-scoped "N /mo" (last 30 days, any label)
  // and the INBOX-now bucket counts a verb can actually move. A sender
  // that mails 71×/month and has all of it already archived produces a
  // legitimate all-zero chip row under a large "71 /mo" — which reads as
  // a broken preview unless the modal says why (founder report
  // 2026-07-27; findings doc 5.14). Gated on `livePreviewReady` so a
  // stale cache never narrates the inbox.
  // At all-mail reach the "not in your inbox" reconciliation is moot —
  // the whole point of the widened reach is that archived mail IS in
  // scope, so the notice stays silent rather than narrating a scope the
  // action no longer has.
  const inboxScopeNotice =
    livePreviewReady && activeReach === 'inbox_only'
      ? describeInboxScope({
          inboxTotal: pickBucketCount(bucketCounts, null),
          windowCount: compositeCount,
          olderThanDays: showWindowRow ? olderThanDays : null,
          // Bulk has no single arrival figure to name — omit rather than
          // invent one; the copy drops the clause when it is null.
          // Same 90-day field the strip above renders, so the notice
          // cannot name a window the strip does not show.
          recentArrivals: isBulk ? null : (request?.senders[0]?.monthlyVolume ?? null),
        })
      : ({ kind: 'none' } as const);
  // Name the verb the COUNT belongs to, not the primary. On Unsubscribe
  // + a backlog secondary the zero describes the secondary; saying
  // "Unsubscribe only acts on mail still in the inbox" would be flatly
  // false — Unsubscribe never touches inbox mail, which is exactly why
  // it is the one primary that offers a backlog secondary at all.
  const inboxScopeVerbLabel = hasSecondaryAction
    ? secondaryVerb === 'delete'
      ? 'Delete'
      : 'Archive'
    : verb
      ? verbDisplay(verb).label
      : null;
  // Who the bulk counts actually cover. Protected senders are left out of
  // the totals, so once any were excluded "these senders" overstates it.
  const countedSubject = !isBulk
    ? 'this sender'
    : (bulkPreview?.data?.protectedCount ?? 0) > 0
      ? 'the unprotected senders'
      : 'these senders';
  // Bulk totals EXCLUDE Protected senders, so a zero there only covers
  // the whole selection when nothing was excluded — otherwise "no email
  // from these senders" is a claim the preview never measured.
  const nothingLeftToDelete =
    isDeleteVerb &&
    livePreviewReady &&
    inboxCounts?.all === 0 &&
    allMailCounts?.all === 0 &&
    (!isBulk || bulkPreview?.data?.protectedCount === 0);
  const inboxScopeCopy = nothingLeftToDelete
    ? `No emails left to move to Trash. There is no email from ${
        countedSubject
      } in Inbox or archived.`
    : inboxScopeVerbLabel
      ? inboxScopeNoticeCopy(
          inboxScopeNotice,
          inboxScopeVerbLabel,
          countedSubject,
          // With the reach chips on screen, "only acts on mail still in
          // the inbox" would be false one sentence before the hint that
          // says how to reach past it (ADR-0028).
          { verbActsBeyondInbox: reachAvailable },
        )
      : null;
  // ADR-0028 — when the inbox is empty but the mailbox still holds mail
  // this Delete COULD reach, point at the chip that reaches it. Modal-
  // local on purpose: the shared notice is also rendered by surfaces
  // that may have no reach control to point at (the Screener's chips
  // carry their own live counts instead of this hint).
  const archivedReachHint =
    inboxScopeNotice.kind === 'empty-inbox' && reachAvailable && (allMailCounts?.all ?? 0) > 0
      ? `Switch to "Inbox + archived" to reach ${(allMailCounts?.all ?? 0).toLocaleString(
          'en-US',
        )} archived email${(allMailCounts?.all ?? 0) === 1 ? '' : 's'}.`
      : null;
  // Founder report 2026-08-25 — "how much is where", on every verb.
  //
  // The reach CHIPS stay Delete-only (ADR-0028: only Delete may act
  // past the inbox), but the QUESTION they happened to answer is one
  // every preview provokes. A Later preview reading "0 emails
  // currently match" under a strip reading "200 in last 90d · 6,668
  // received" is three true numbers that reconcile to nothing a reader
  // can see, and the founder went to Gmail to discover the mail was
  // under a label.
  //
  // Suppressed when `archivedReachHint` is up: that hint already names
  // the same figure and adds the control, so both would print 6,275 a
  // line apart. Single-sender only — a bulk selection has no one
  // "N received" figure on screen for the split to close against.
  const mailLocationLine =
    !isBulk && livePreviewReady && archivedReachHint === null
      ? mailLocationCopy({
          inboxNow: pickBucketCount(compositePreview?.counts, null),
          allMailNow: compositePreview?.allMail?.counts.all,
          // The same figure the strip above prints as "N received", so
          // the split closes against a number already on screen instead
          // of introducing a fourth one.
          receivedTotal: request?.senders[0]?.totalReceived ?? null,
        })
      : null;
  // Every window chip reads 0 when the inbox holds nothing from this
  // sender — five identical zeros no choice can change. Suppress the row
  // and let the notice carry the story. Deliberately a RENDER flag only:
  // `showWindowRow` still governs `buildConfirmOpts`, so the wire payload
  // is byte-identical either way.
  const showWindowChips = showWindowRow && inboxScopeNotice.kind !== 'empty-inbox';
  // With the chip row gone the "(older than N days)" qualifier describes
  // a control the user can no longer see.
  const showWindowQualifier = olderThanDays !== null && inboxScopeNotice.kind !== 'empty-inbox';
  // B — a chip row whose top buckets tie reads as a broken control
  // (github.com: four chips all showing 2,908). Explain WHY instead of
  // merging them; see `tiedWindowNoticeCopy` for why merging is unsafe.
  const tiedWindowCopy = livePreviewReady
    ? tiedWindowNoticeCopy(
        TIME_WINDOW_PRESETS.map((preset) => ({
          label: preset.label,
          count: pickBucketCount(bucketCounts, preset.days),
        })),
        // The age clause explains INBOX ties; at all-mail reach the tie
        // has a different denominator, so pass null and let the copy
        // state the tie without an inbox age it no longer describes.
        isBulk || activeReach === 'all_mail' ? null : newestInboxDays(compositePreview),
        isBulk ? 'these senders' : 'this sender',
      )
    : null;

  // A3 quota-aware preview. One unit = one sender acted upon; every
  // modal verb counts (Keep never opens this modal). Bulk needs one
  // unit per ACTIONABLE (non-protected) sender — the same set the
  // server will charge.
  //
  // A backlog verb is a SECOND unit per sender. `recordUnsubIntent`
  // preflights `includesBacklogAction ? 2 : 1` and consumes one for the
  // intent row; the paired Archive/Delete then enqueues as its own
  // action and consumes the other (actions.service.ts). This constant
  // was hardcoded `1`, so an Unsubscribe + Archive preview promised a
  // Free user with one action left that it fit — and the 402 landed
  // AFTER the unsubscribe request had already gone out, which cannot be
  // undone (founder screenshot 2026-08-27).
  //
  // A no-channel Unsubscribe consumes nothing (`method !== 'none'`
  // guards the assert), so it must not claim a unit either.
  const quotaRemaining = cleanupQuota?.remaining ?? null;
  const unitsPerSender =
    (isUnsubVerb && unsubscribeChannel === 'none' ? 0 : 1) + (hasSecondaryAction ? 1 : 0);
  // The live bulk preview's actionable (non-Protected) sender count —
  // shared by the quota math below and, post-guard, `n` (the
  // eyebrow/title/subject count) — both need to agree with what
  // `enqueueBulkComposite` will actually commit to. `null` outside bulk.
  const bulkActionableSenderCount = isBulk
    ? bulkPreview?.data
      ? bulkPreview.data.senders.filter((s) => !s.protected).length
      : (request?.senders.length ?? 0)
    : null;
  // Codex review 2026-09-03 round 4: `bulkActionableSenderCount` above
  // only knows Protected/missing — the bulk preview endpoint is
  // verb-agnostic and carries no unsubscribe-capability field.
  // `enqueueBulkUnsubscribe` (actions.service.ts) throws
  // `NO_ACTIONABLE_SENDERS` unless at least one sender is CURRENTLY
  // one-click; a mailto sender is recorded but never sent, so a
  // selection down to mailto-only is executable=0 even though it's
  // still "not Protected." Cross-references the capability known when
  // this request was BUILT — stale only if a sender's OWN method
  // changed since then (rare), but correct for the common failure this
  // closes: the one-click sender in a mixed selection went Protected or
  // was deleted before confirm.
  const bulkUnsubExecutableCount =
    isBulk && isUnsubVerb && bulkPreview?.data
      ? bulkPreview.data.senders.filter((s) => {
          const original = request?.senders.find((rs) => rs.id === s.senderId);
          return !s.protected && original?.unsubscribeMethod === 'one_click';
        }).length
      : null;
  const unitsNeeded = unitsPerSender * (bulkActionableSenderCount ?? 1);
  // Set when `requestAction` already trimmed this request to what the
  // allowance covers. The senders here ARE the ones that will run, so the
  // preview above is truthful as-is; all this changes is the copy, which
  // has to say the selection was larger.
  const quotaCappedFrom = request?.quotaCappedFrom ?? null;
  const quotaShort = quotaRemaining !== null && unitsNeeded > quotaRemaining;

  // `nothingToActOn` already carries its own verb test — repeating a
  // narrower one here would silently re-exclude Later.
  //
  // `quotaShort` only blocks when NOTHING can run — a capped request has
  // already been trimmed to fit, so blocking it here would restore the
  // dead end the cap exists to remove.
  //
  // Codex review 2026-09-03 round 2: `nothingToActOn` only covers verbs
  // that move current inbox mail, and is deliberately silent for
  // Unsubscribe (it acts on future mail, not a count). But a bulk
  // preview can independently resolve to zero ACTIONABLE senders — every
  // queued one went Protected, or was deleted, since the request was
  // built — for ANY bulk verb including Unsubscribe, and nothing else
  // catches that. Gate on the same live count `unitsNeeded` above and
  // `n` below both already use.
  const nothingActionableBulk =
    isBulk &&
    bulkPreview?.data !== undefined &&
    (bulkUnsubExecutableCount ?? bulkActionableSenderCount) === 0;
  const confirmDisabled =
    livePreviewBlocksConfirm ||
    nothingToActOn ||
    wakeAtInvalid ||
    unsubNothingToSend ||
    nothingActionableBulk ||
    (quotaShort && !quotaCappedFrom) ||
    submitting;

  // Swap confirm for a truthful upgrade action when the quota cannot
  // cover this click — routed through the same upgrade-gate store the
  // server's 402 uses, so both paths land on one UpgradeModal.
  const reportQuotaShort = () => {
    const limit = TIER_MANIFEST.free.cleanupActionsPerMonth ?? 0;
    useUpgradeGateStore.getState().report({
      reason: 'free_cap',
      details: {
        remaining: quotaRemaining ?? 0,
        limit,
        used: Math.max(0, limit - (quotaRemaining ?? 0)),
        requiredUnits: unitsNeeded,
        resetsAt: cleanupQuota?.resetsAt ?? null,
      },
    });
    onCancel();
  };

  // Derived ConfirmOptions for onConfirm — packages secondary into the
  // shape the BE composite endpoint expects.
  const buildConfirmOpts = (): ConfirmOptions => {
    const opts: ConfirmOptions = {};
    if (isLaterVerb && wakeAt !== null) opts.wakeAt = wakeAt;
    if (showWindowRow) opts.olderThanDays = olderThanDays;
    // ADR-0028 — only the non-default value travels; the server treats
    // an absent field as inbox_only and rejects all_mail anywhere else.
    if (reachAvailable && activeReach === 'all_mail') opts.reach = 'all_mail';
    if (hasSecondaryAction) {
      opts.secondary = {
        type: secondaryVerb as 'archive' | 'delete',
        olderThanDays,
      };
    } else if (showSecondaryRow) {
      opts.secondary = null;
    }
    // The explicit "act anyway" acknowledgement for a Protected sender.
    // Never set on a bulk request — D245 excludes protected senders from
    // bulk entirely, so there is nothing to override there.
    if (needsProtectedOverride) opts.override = true;
    // Backwards-compat surface for review-session (pre-spec-v1.2).
    opts.archiveHistoric = hasSecondaryAction && secondaryVerb === 'archive';
    return opts;
  };

  // ⌘⏎ confirms. Esc, the backdrop and initial focus are owned by
  // `PreviewSheet` — which keeps Cancel and Esc LIVE while submitting,
  // because this sheet never hands it a `busyLabel` (see `primary` below).
  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !confirmDisabled) {
        e.preventDefault();
        onConfirm(buildConfirmOpts());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `buildConfirmOpts` is a stable closure over the deps below; listing
    // it would re-add the same dependencies and the linter would still
    // flag the duplicate. Listing the inputs directly keeps the surface
    // explicit and the dep set accurate.
  }, [
    request,
    submitting,
    secondaryVerb,
    olderThanDays,
    reach,
    reachAvailable,
    activeReach,
    wakeAt,
    onConfirm,
    confirmDisabled,
    showSecondaryRow,
    showWindowRow,
    hasSecondaryAction,
  ]);

  const auth = useOptionalAuth();

  if (!request) return null;

  const { senders } = request;
  const historic = senders.reduce((sum, s) => sum + s.totalReceived, 0);
  const requestedSenderCount = senders.length;
  const selectedCount = request.selectedCount ?? requestedSenderCount;
  const skippedCount = (request.skipped?.protectedCount ?? 0) + (request.skipped?.peopleCount ?? 0);
  const eligibleCount = Math.max(0, selectedCount - skippedCount);
  // Prefer the live bulk preview's actionable count — it independently
  // re-resolves every sender id and can drop it (deleted since queued) or
  // flag it newly Protected, exactly like `unitsNeeded`'s bulk branch
  // above; `enqueueBulkComposite` repeats that same resolution and skips
  // those rows. `request.actionableCount` is a caller-stated snapshot, and
  // `eligibleCount`'s client arithmetic never narrows — both are the
  // fallback for the single-sender paths, or while the preview hasn't
  // resolved yet (Codex review 2026-09-03, QA-archive-20260901-01 — the
  // title must name the same count the confirm click actually commits to).
  const n = bulkActionableSenderCount ?? request.actionableCount ?? eligibleCount;
  const single = senders.length === 1;
  const leadSender = senders[0]!;
  const activeMailboxEmail = mailboxEmail ?? (auth ? getActiveMailboxEmail(auth.me) : null);
  const allMailScope = activeReach === 'all_mail';

  const primaryVerb = isDeleteVerb
    ? 'delete'
    : isArchiveVerb
      ? 'archive'
      : isLaterVerb
        ? 'later'
        : 'unsubscribe';
  const presentation = buildActionPresentation({
    verb: primaryVerb,
    liveCount: isUnsubVerb ? 0 : (compositeCount ?? null),
    planUndoDeadline: null,
    wakeAt: isLaterVerb ? wakeAt : null,
    unsubscribeChannel,
    // Absolute times render in the reader's own clock: every one of
    // these surfaces is opened by a click, never server-rendered.
    timeZone: 'viewer',
    secondaryAction:
      secondaryVerb === null ? null : { verb: secondaryVerb, liveCount: compositeCount ?? null },
    // ADR-0028 — the copy must name the scope the reach control widened to.
    reach: activeReach,
  });
  const { primary, secondary } = presentation;

  // ── The count (title) ────────────────────────────────────────────────
  // The ONE count source (`compositeCount`) — and only once the live
  // preview has settled: a cached count mid-refetch never reaches the
  // title, exactly as it never arms confirm (D226).
  const countsMail = primaryActsOnInbox || hasSecondaryAction;
  const liveCount =
    countsMail && livePreviewReady && compositeCount !== undefined ? compositeCount : null;
  const zeroTitle = primaryActsOnInbox && liveCount === 0;
  // A zero inside a window, with inbox mail older than it: the window is
  // the reason, and widening it is the way out.
  const windowedZero =
    zeroTitle && olderThanDays !== null && (pickBucketCount(bucketCounts, null) ?? 0) > 0;
  const zeroWho = single
    ? leadSender.name
    : (bulkPreview?.data?.protectedCount ?? 0) > 0
      ? 'the unprotected senders'
      : 'these senders';
  const fromWho = single ? leadSender.name : sendersLabel(n);
  const bulkTail = single ? '' : ` from ${sendersLabel(n)}`;
  const verbWord = verb ? verbDisplay(verb).label : '';

  const title = (() => {
    if (zeroTitle) {
      return windowedZero
        ? `Nothing older than ${windowName(olderThanDays)} from ${zeroWho}`
        : `Nothing in your inbox${allMailScope ? ' or archive' : ''} from ${zeroWho}`;
    }
    if (isArchiveVerb || isDeleteVerb) {
      return liveCount === null
        ? `${verbWord} email from ${fromWho}?`
        : `${verbWord} ${emailsLabel(liveCount)}${bulkTail}?`;
    }
    if (isLaterVerb) {
      return liveCount === null
        ? `Move email from ${fromWho} to Later?`
        : `Move ${emailsLabel(liveCount)}${bulkTail} to Later?`;
    }
    const base = `Unsubscribe from ${fromWho}`;
    if (!hasSecondaryAction || liveCount === 0) return `${base}?`;
    const backlogVerb = secondaryVerb === 'delete' ? 'delete' : 'archive';
    const what = liveCount === null ? 'their email' : emailsLabel(liveCount);
    return single
      ? `Unsubscribe and ${backlogVerb} ${what}?`
      : `${base} and ${backlogVerb} ${what}?`;
  })();

  // ── Where it goes (subtitle) ─────────────────────────────────────────
  const destination = isArchiveVerb
    ? 'They leave your inbox and stay in Gmail.'
    : isDeleteVerb
      ? allMailScope
        ? 'Inbox and archived email both move to Gmail Trash.'
        : 'They move to Gmail Trash.'
      : isLaterVerb
        ? 'They wait in Gmail’s DeclutrMail/Later label, then return to your inbox.'
        : null;
  // ADR-0028 — when the inbox is empty but the mailbox still holds mail
  // this Delete COULD reach, the subtitle names the control that reaches it.
  const subtitle: string | null = zeroTitle
    ? (archivedReachHint ?? (windowedZero ? inboxScopeCopy : null))
    : isUnsubVerb
      ? primary.unsubscribeChannel.kind === 'not-applicable' ||
        primary.unsubscribeChannel.kind === 'varies'
        ? primary.futureMail.summary
        : primary.unsubscribeChannel.summary
      : single
        ? `From ${leadSender.name}. ${destination ?? ''}`.trim()
        : destination;

  // ── How to undo it (note) ────────────────────────────────────────────
  // Protected senders the action will not touch — said ONCE. Two
  // disjoint sets: the ones the eligibility gate dropped before the sheet
  // opened (`request.skipped`) and the ones the live bulk preview newly
  // flags among the requested senders (`protectedCount`).
  const protectedSkipped =
    (request.skipped?.protectedCount ?? 0) + (bulkPreview?.data?.protectedCount ?? 0);
  const peopleSkipped = request.skipped?.peopleCount ?? 0;
  const skipSentence =
    protectedSkipped > 0 && peopleSkipped > 0
      ? `${protectedSkipped} Protected sender${protectedSkipped === 1 ? '' : 's'} and ${peopleLabel(peopleSkipped)} are skipped.`
      : protectedSkipped > 0
        ? `${protectedSkipped} Protected sender${protectedSkipped === 1 ? ' is' : 's are'} skipped.`
        : peopleSkipped > 0
          ? `${peopleLabel(peopleSkipped)} ${peopleSkipped === 1 ? 'is' : 'are'} skipped.`
          : null;
  const undoNote = zeroTitle
    ? null
    : isUnsubVerb
      ? `A sent unsubscribe can’t be recalled.${
          secondary !== null ? ` ${secondary.activityUndo.summary}` : ''
        }`
      : [
          primary.activityUndo.summary,
          // Delete is the one verb where the reader plausibly fears the
          // opposite (CLAUDE.md §2.3).
          ...(isDeleteVerb && primary.futureMail.inPreview ? [primary.futureMail.summary] : []),
          ...(primary.bulkReturnNotice === null ? [] : [primary.bulkReturnNotice]),
        ].join(' ');
  const note = [undoNote, skipSentence].filter((s): s is string => s !== null).join(' ');

  // ── Confirm ──────────────────────────────────────────────────────────
  const primaryLabel = (() => {
    // Name the override in the button itself — the click IS the
    // acknowledgement, so it must not read like an ordinary confirm.
    if (needsProtectedOverride && !hasSecondaryAction) return `${verbWord} anyway`;
    if (hasSecondaryAction)
      return `Unsubscribe + ${secondaryVerb === 'delete' ? 'Delete' : 'Archive'}`;
    if (primaryActsOnInbox && liveCount !== null && liveCount > 0) {
      return `${verbWord} ${fmt(liveCount)}`;
    }
    return verbWord;
  })();

  // Subjects for the "Show what currently matches" panel (spec v1.3 —
  // recent beats oldest for 3-sec sender recognition). Single sender
  // only; read from `compositePreview.recentMessages[bucket]` and trimmed
  // to the bucket's REAL total so the sample never offers more rows than
  // the count it previews (live smoke 2026-06-09 saw "5 of 3"). Wire
  // subjects ONLY — a fabricated current-match list on the D226 trust
  // surface is worse than none (§10 no-fake-data).
  const subjectsPreview = single
    ? (
        pickBucketSubjects(
          allMailScope
            ? compositePreview?.allMail?.recentMessages
            : compositePreview?.recentMessages,
          olderThanDays,
        ) ?? []
      ).slice(0, Math.min(5, compositeCount ?? 5))
    : [];

  // D — a Gmail search mirroring THIS preview's scope, so the user can
  // eyeball the real messages before confirming. Only when the preview
  // has resolved and only for a single sender (bulk has no one `from:`).
  // Approximate by construction — see `buildActionScopeSearchLink`.
  const verifyInGmailUrl =
    livePreviewReady && single && activeMailboxEmail
      ? GmailOpenLinkService.buildActionScopeSearchLink({
          mailboxEmail: activeMailboxEmail,
          from: leadSender.email,
          olderThanDays: showWindowRow ? olderThanDays : null,
          // ADR-0028 — mirror the selected reach: dropping `in:inbox`
          // makes the Gmail search cover archived mail too.
          inboxOnly: !allMailScope,
        })
      : null;

  // ── Controls that change the count ───────────────────────────────────
  // ADR-0028 reach pair. Each option carries ITS reach's count — window-
  // scoped only while the window is a live control; with the window
  // suppressed (empty inbox) a hidden 180d default would put an
  // unexplained smaller figure on the pair (live smoke 2026-07-28).
  const reachWindow = showWindowChips ? olderThanDays : null;
  const inboxReachCount = pickBucketCount(inboxCounts, reachWindow);
  const allMailReachCount = pickBucketCount(allMailCounts, reachWindow);
  // Shown only where the options give different counts — but never
  // hidden while armed at the wider reach, which would leave a choice
  // the user cannot see or undo.
  const showReach = reachAvailable && (allMailScope || inboxReachCount !== allMailReachCount);
  const windowOptions = TIME_WINDOW_PRESETS.map((preset) => ({
    value: preset.days === null ? 'all' : String(preset.days),
    days: preset.days,
    // "All inbox" is a lie once the reach covers archived mail.
    label: preset.days === null && allMailScope ? 'All mail' : preset.label,
    count: pickBucketCount(bucketCounts, preset.days),
  }));
  // Five options that all give one count are noise — render only when the
  // choice changes the number. Deliberately a RENDER flag: `showWindowRow`
  // still governs `buildConfirmOpts`, so the payload is byte-identical.
  const showWindowSelect =
    showWindowChips &&
    windowOptions.some((o) => o.count !== undefined) &&
    windowOptions.some((o) => o.count !== windowOptions[0]!.count);

  const controls: ReactNode[] = [];
  if (showSecondaryRow) {
    controls.push(
      <SheetSegmented
        key="secondary"
        label="Also act on past emails"
        value={secondaryVerb ?? 'none'}
        onChange={(next) => {
          setSecondaryVerb(next === 'none' ? null : next);
          // The wider destructive reach is never carried across a
          // secondary change — re-pick it.
          setReach('inbox_only');
        }}
        options={[
          { value: 'none', label: 'Leave alone' },
          { value: 'archive', label: 'Archive them' },
          { value: 'delete', label: 'Delete them' },
        ]}
      />,
    );
  }
  if (showReach) {
    controls.push(
      <SheetSegmented
        key="reach"
        label="Where it applies"
        value={activeReach}
        onChange={(next) => {
          // Choosing the option that advertised its UN-WINDOWED count (the
          // window was hidden for an empty inbox) must arm exactly that
          // number — so the window resets to "All mail" instead of a hidden
          // 180d default silently shaving it (design-system gate 2026-07-28).
          if (next === 'all_mail' && !showWindowChips) setOlderThanDays(null);
          setReach(next);
        }}
        options={[
          { value: 'inbox_only', label: 'Inbox only', count: inboxReachCount },
          { value: 'all_mail', label: 'Inbox + archived', count: allMailReachCount },
        ]}
      />,
    );
  }
  if (showWindowSelect) {
    controls.push(
      <label key="window" style={wellStyle}>
        <span>How far back</span>
        <select
          aria-label="How far back to act on"
          value={olderThanDays === null ? 'all' : String(olderThanDays)}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setOlderThanDays(value === 'all' ? null : Number(value));
          }}
          style={wellInputStyle}
        >
          {windowOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.count === undefined ? o.label : `${o.label} · ${fmt(o.count)}`}
            </option>
          ))}
        </select>
      </label>,
    );
  }
  if (isLaterVerb) {
    controls.push(
      <label key="later" style={wellStyle}>
        <span>Returns</span>
        <input
          type="datetime-local"
          aria-label="Later return time"
          value={wakeAt === null ? '' : toLocalDateTimeInput(wakeAt)}
          min={toLocalDateTimeInput(new Date(Date.now() + 60_000).toISOString())}
          onChange={(event) => {
            const next = new Date(event.currentTarget.value);
            setWakeAt(Number.isNaN(next.getTime()) ? null : next.toISOString());
          }}
          style={wellInputStyle}
        />
      </label>,
    );
  }
  // Protected acknowledgement (D245 / D42). The sender is Protected and
  // this is an explicit single-sender action, so the path stays open —
  // but the user is told, before the click that carries `override`.
  // Protection is usually AUTOMATIC (≥3 replies, a star, or repeated
  // Gmail-importance), so the user may not know they set it.
  if (needsProtectedOverride) {
    controls.push(
      <p
        key="protected"
        style={{ margin: 0, fontSize: text.sm, lineHeight: 1.45, color: color.fgSoft }}
      >
        {protectedReason !== null ? (
          <>
            <strong style={{ color: color.danger, fontWeight: 600 }}>Protected</strong> —{' '}
            {protectionReasonClause(protectedReason)}. This action applies anyway.
          </>
        ) : (
          <>
            <strong style={{ color: color.danger, fontWeight: 600 }}>Protected.</strong> Bulk and
            automatic actions skip this sender; this action will not.
          </>
        )}
      </p>,
    );
  }

  // ── Status (why confirm is unavailable) and the footer cost line ─────
  // No sendable channel first: while it holds, nothing the preview could
  // return would make the batch runnable, so a "Loading…" line would only
  // promise a wait that ends in the same disabled button.
  const status: ReactNode = unsubNothingToSend ? (
    'No sendable unsubscribe for these senders. Archive moves their email out of your inbox instead.'
  ) : previewStateCopy !== null ? (
    <StatusWithAction
      message={previewStateCopy}
      action={
        !livePreviewUnavailable
          ? undefined
          : previewSenderGone
            ? onRefreshSenders && { label: 'Refresh senders', onClick: onRefreshSenders }
            : onRetryPreview && { label: 'Retry preview', onClick: onRetryPreview }
      }
    />
  ) : nothingActionableBulk ? (
    'Every selected sender is now Protected or gone. Close and refresh.'
  ) : null;
  // A no-op spends no cleanup action, and a sheet that cannot run has
  // nothing to charge — the status line above is the reason.
  const quotaLine =
    previewStateCopy !== null || nothingActionableBulk || nothingToActOn
      ? null
      : quotaCappedFrom
        ? `${unitsNeeded} of ${quotaCappedFrom} eligible senders — all you have left this month.`
        : quotaShort
          ? `This needs ${unitsNeeded} cleanup action${unitsNeeded === 1 ? '' : 's'} but only ${quotaRemaining} ${quotaRemaining === 1 ? 'is' : 'are'} left this month.`
          : quotaRemaining !== null
            ? `Uses ${unitsNeeded} of your ${quotaRemaining} cleanup action${quotaRemaining === 1 ? '' : 's'} left this month.`
            : null;

  // ── Details ──────────────────────────────────────────────────────────
  // Short label/value facts (`SheetFactList`). Each value says the same
  // fact as the sentence it replaced — cut, never widened or narrowed.
  // The count itself is the title; the undo is the note.
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
  // The senders card's own arrival facts, from the same row and in the
  // same words — "N in last 90d · N received" (ADR-0037). INBOX-now is
  // deliberately NOT repeated: the title is that number, live. Unknown
  // volume renders "—", never a factual 0 (finding 5.15).
  if (single) {
    facts.push(
      { label: 'Domain', value: compositePreview?.sender?.domain ?? leadSender.domain },
      {
        label: 'Sender',
        value: `${leadSender.monthlyVolume == null ? '—' : fmt(leadSender.monthlyVolume)} in last 90d · ${fmt(leadSender.totalReceived)} received`,
      },
    );
    const days = compositePreview?.sender?.lastSeenDays ?? leadSender.lastDays;
    facts.push({
      label: 'Last seen',
      value: days === 0 ? 'Today' : `${fmt(days)} day${days === 1 ? '' : 's'} ago`,
    });
    const wrote = compositePreview?.sender?.wroteToCount ?? leadSender.wroteToCount;
    if (wrote !== undefined && wrote !== null && wrote > 0) {
      facts.push({ label: 'You wrote', value: `${fmt(wrote)} time${wrote === 1 ? '' : 's'}` });
    }
  }
  if (countsMail && livePreviewReady) {
    if (compositeCount === undefined) {
      if (!single) facts.push({ label: 'Received', value: `${fmt(historic)} in total` });
    } else {
      const windowPart = showWindowQualifier
        ? ` (older than ${olderThanDays} day${olderThanDays === 1 ? '' : 's'})`
        : '';
      facts.push({
        label: 'Count',
        value: `${allMailScope ? 'Inbox + archived' : 'Inbox'} now${windowPart}, rechecked when it runs`,
      });
    }
  }
  // Why a true count can still read as a contradiction — see
  // `describeInboxScope`. Skipped here when it already is the subtitle.
  if (inboxScopeCopy !== null && subtitle !== inboxScopeCopy) {
    facts.push({ label: 'Why none', value: inboxScopeCopy });
  }
  // Where the sender's mail actually is — both counts from the one
  // composite preview, so the split cannot drift.
  if (mailLocationLine) {
    facts.push({
      label: 'Where it is now',
      value: <span data-testid="mail-location-line">{mailLocationValue(mailLocationLine)}</span>,
    });
  }
  if (tiedWindowCopy) facts.push({ label: 'Windows', value: tiedWindowCopy });
  if (showReach && allMailScope) {
    facts.push(
      { label: 'Never touched', value: 'Trash, Spam, Drafts, Chat' },
      { label: 'Undo', value: 'Puts each email back where it was' },
    );
  }
  if (primary.schedule.kind === 'scheduled') {
    facts.push({
      label: 'Returns',
      value: afterLead(primary.schedule.summary, 'Returns to Inbox '),
    });
  }
  if (isUnsubVerb) {
    facts.push({
      label: 'Past email',
      value:
        secondary === null ? 'Stays where it is' : secondary.currentMail.summary.replace(/\.$/, ''),
    });
  }
  const trash =
    primary.providerRecovery.kind === 'gmail-trash'
      ? primary.providerRecovery
      : secondary?.providerRecovery.kind === 'gmail-trash'
        ? secondary.providerRecovery
        : null;
  if (trash !== null) {
    facts.push({
      label: 'Gmail Trash',
      value: `Kept up to ${trash.approximateDays} days, then deleted for good`,
    });
  }
  if (isUnsubVerb) {
    facts.push({ label: 'Cleanup actions', value: 'Acting on past email uses a second one' });
  }
  // D226 honesty — when the eligibility gate narrowed the selection
  // before this sheet opened, say by how much and why.
  if (request.selectedCount !== undefined && (selectedCount > 1 || skippedCount > 0)) {
    facts.push({
      label: 'Senders',
      value: (
        <span aria-label="Senders included in this bulk action">
          {/* The quota segment is what reconciles "eligible" with the
              title once a cap is in play. */}
          {selectedCount} selected, {eligibleCount} eligible, {skippedCount} skipped
          {quotaCappedFrom ? `, ${requestedSenderCount} within this month's actions` : ''}
        </span>
      ),
    });
  }
  if (protectedSkipped > 0) {
    facts.push({ label: 'Protected', value: 'Unprotect a sender to include it' });
  }
  if (peopleSkipped > 0) {
    facts.push({ label: 'People', value: 'Unsubscribe doesn’t apply to people' });
  }

  // D248 — the per-state split, never one aggregate number. A delivered
  // unsubscribe cannot be recalled (D58), so what will and will not be
  // sent has to be legible before confirm. `mailto` senders stay
  // user-sent (D230): the one-click fan-out skips them.
  const unsubFacts: SheetFactItem[] =
    unsubCapabilities === null || single
      ? []
      : [
          ...(unsubCapabilities.one_click > 0
            ? [
                {
                  label: 'One-click',
                  value: `${sendersLabel(unsubCapabilities.one_click)}, we unsubscribe for you`,
                },
              ]
            : []),
          ...(unsubCapabilities.mailto > 0
            ? [
                {
                  label: 'By email',
                  value: `${sendersLabel(unsubCapabilities.mailto)}, you send the email yourself`,
                },
              ]
            : []),
          ...(unsubCapabilities.none > 0
            ? [{ label: 'No unsubscribe', value: sendersLabel(unsubCapabilities.none) }]
            : []),
          ...(unsubCapabilities.unknown > 0
            ? [{ label: 'Not checked yet', value: sendersLabel(unsubCapabilities.unknown) }]
            : []),
        ];

  const breakdownById = new Map(
    (bulkPreview?.data?.senders ?? []).map((s) => [s.senderId, s] as const),
  );
  const visibleSenders = showAllSenders ? senders : senders.slice(0, 6);
  const showMatchesToggle = single && !unsubscribeMovesNothing && (compositeCount ?? 0) > 0;
  const showGmailLink = verifyInGmailUrl !== null && !unsubscribeMovesNothing;

  const details = (
    <>
      {/* Per-sender breakdown (D52) — FIRST for a bulk sheet: each row
          carries the REAL count for the active window and reach from the
          aggregated preview; Protected senders are flagged (the server
          skips them). */}
      {!single && (
        <div aria-label="Senders in this action" style={senderListStyle}>
          {visibleSenders.map((s) => {
            const row = breakdownById.get(s.id);
            const rowCount = pickBucketCount(
              allMailScope ? row?.allMailCounts : row?.counts,
              olderThanDays,
            );
            return (
              <div key={s.id} style={senderRowStyle}>
                <span style={{ fontWeight: 500, minWidth: 0, overflowWrap: 'anywhere' }}>
                  {s.name}
                </span>
                {row?.protected ? (
                  <span style={{ color: color.fgMuted }}>Protected</span>
                ) : (
                  rowCount !== undefined && <span style={factNumberStyle}>{fmt(rowCount)}</span>
                )}
              </div>
            );
          })}
          {senders.length > 6 && (
            <SheetLinks>
              <SheetTextAction
                onClick={() => setShowAllSenders((v) => !v)}
                expanded={showAllSenders}
              >
                {showAllSenders ? 'Show fewer' : `Show all ${senders.length}`}
              </SheetTextAction>
            </SheetLinks>
          )}
        </div>
      )}

      <SheetFactList facts={unsubFacts} aria-label="Unsubscribe breakdown" />
      <SheetFactList facts={facts} />

      {/* Current matches — privacy-safe subjects, single sender only, and
          never for an Unsubscribe that moves no mail (founder screenshot
          2026-08-27: a sample of mail nothing is going to touch). */}
      {showSubjects && !unsubscribeMovesNothing && subjectsPreview.length > 0 && (
        <div style={listStyle}>
          {/* Date first: on a windowed action this sample is the 5 most
              recent WITHIN the bucket, and the date is how the reader
              checks it respects the window they picked. */}
          {subjectsPreview.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: space[3], alignItems: 'baseline' }}>
              {s.date !== null && (
                <time
                  dateTime={s.date}
                  style={{
                    color: color.fgMuted,
                    flex: '0 0 auto',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {shortDate(s.date)}
                </time>
              )}
              <span style={{ color: color.fg, minWidth: 0 }}>{s.subject}</span>
            </div>
          ))}
          <span style={{ fontSize: text.xs, color: color.fgMuted }}>
            Subjects only. We never fetch or store full email contents.
          </span>
        </div>
      )}

      {(showGmailLink || showMatchesToggle) && (
        <SheetLinks>
          {/* D — let the reader verify the real set in Gmail BEFORE
              confirming. "Approximate" on purpose: Gmail's `older_than:`
              is day-granular and live, so its count can differ. */}
          {showGmailLink && (
            <SheetTextAction
              href={verifyInGmailUrl ?? undefined}
              title="Approximate — Gmail filters by whole days."
            >
              Check in Gmail <span aria-hidden="true">↗</span>
            </SheetTextAction>
          )}
          {showMatchesToggle && (
            <SheetTextAction onClick={() => setShowSubjects((v) => !v)} expanded={showSubjects}>
              {showSubjects
                ? 'Hide matches'
                : `Show ${fmt(subjectsPreview.length)} of ${fmt(compositeCount ?? 0)}`}
            </SheetTextAction>
          )}
        </SheetLinks>
      )}
    </>
  );

  return (
    // Stacking context above the phone selection FAB (z 130), as the
    // previous overlay was; `PreviewSheet` itself is fixed to the viewport.
    <div style={{ position: 'relative', zIndex: 151 }}>
      <PreviewSheet
        onClose={onCancel}
        testId="senders-confirm-sheet"
        icon={
          single ? (
            <Avatar
              name={leadSender.name}
              domain={leadSender.domain}
              size={64}
              hasMark={leadSender.brandMark}
            />
          ) : (
            <AvatarStack senders={senders} />
          )
        }
        title={title}
        subtitle={subtitle === null ? undefined : <span id="dm-confirm-lead">{subtitle}</span>}
        note={note === '' ? undefined : note}
        details={details}
        primary={
          quotaShort
            ? // Swap confirm for a truthful upgrade action when the quota
              // cannot cover this click — routed through the same upgrade
              // gate the server's 402 uses.
              { label: 'Upgrade for unlimited cleanup', onClick: reportQuotaShort }
            : {
                // Not `busyLabel`: PreviewSheet locks Cancel, Esc and the
                // backdrop while busy, and this sheet must keep them LIVE
                // so a request that hangs can never seal the user in (see
                // the `submitting` prop). The label + disabled carry it.
                label: submitting ? 'Submitting…' : primaryLabel,
                onClick: () => onConfirm(buildConfirmOpts()),
                // Delete's filled danger button is one of the sanctioned
                // `color.danger` uses (ADR-0019); amber stays
                // Unsubscribe's tone (ADR-0016 A5).
                tone: isDeleteVerb ? 'danger' : isUnsubVerb ? 'warn' : 'primary',
                disabled: confirmDisabled,
              }
        }
        status={status ?? undefined}
        footer={quotaLine === null ? undefined : <span>{quotaLine}</span>}
      >
        {controls.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[3] }}>{controls}</div>
        ) : undefined}
      </PreviewSheet>
    </div>
  );
}

const fmt = (value: number) => value.toLocaleString('en-US');
const emailsLabel = (count: number) => `${fmt(count)} email${count === 1 ? '' : 's'}`;
const sendersLabel = (count: number) => `${fmt(count)} sender${count === 1 ? '' : 's'}`;
const peopleLabel = (count: number) => (count === 1 ? '1 person' : `${fmt(count)} people`);

/** "6 months" — the window a zero belongs to, from the preset the user sees. */
function windowName(days: number | null): string {
  const preset = TIME_WINDOW_PRESETS.find((p) => p.days === days);
  return preset ? preset.label.replace(/\+$/, '') : `${days ?? 0} days`;
}

const wellStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: space[3],
  minHeight: 48,
  padding: `0 ${space[2]}px 0 ${space[4]}px`,
  borderRadius: radius.lg,
  background: color.fill,
  fontSize: text.md,
  fontWeight: 550,
  textAlign: 'left',
};

const wellInputStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: color.fg,
  fontFamily: font.sans,
  fontSize: text.md,
  fontVariantNumeric: 'tabular-nums',
  minHeight: 40,
  minWidth: 0,
  textAlign: 'right',
  cursor: 'pointer',
};

const factNumberStyle: CSSProperties = {
  color: color.fg,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
};

const listStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: space[1] };

// Name left, count right, no per-row separators — the rhythm is the gap.
const senderListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: space[2],
  paddingTop: space[3],
};

const senderRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: space[3],
};

/** Up to three overlapping sender logos — the icon of a bulk sheet. */
function AvatarStack({ senders }: { senders: readonly Sender[] }) {
  const shown = senders.slice(0, 3);
  return (
    <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center' }}>
      {shown.map((s, i) => (
        <span
          key={s.id}
          style={{
            position: 'relative',
            zIndex: shown.length - i,
            display: 'inline-flex',
            marginLeft: i === 0 ? 0 : -18,
            borderRadius: radius.lg,
            // A card-coloured ring separates overlapping tiles in both themes.
            boxShadow: `0 0 0 3px ${color.card}`,
          }}
        >
          <Avatar name={s.name} domain={s.domain} size={52} hasMark={s.brandMark} />
        </span>
      ))}
    </span>
  );
}

/** A disabled-state line with its one way out ("Retry preview"). */
function StatusWithAction({
  message,
  action,
}: {
  message: string;
  action?: { label: string; onClick: () => void } | undefined;
}) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <span>{message}</span>
      {action && (
        <Button tone="default" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </span>
  );
}

/**
 * Age in days of the newest message IN THE INBOX for this sender, or
 * `null` when unknown.
 *
 * Derived from the un-windowed sample's first row, which the BE orders
 * `internal_date DESC` over the INBOX-scoped predicate — so it is the
 * newest inbox message by construction.
 *
 * Deliberately NOT `sender.lastSeenDays`: that is `senders.last_seen_at`,
 * the newest message across ALL labels. The two diverge wildly once mail
 * is archived — measured 2026-07-27 on the dev mailbox, `linkedin.com`
 * reported lastSeen 0 days while its newest INBOX message was 5,269 days
 * old, and `tcs.com` 4,539 vs 20,662. Using it here would have printed a
 * confident, wrong age on a trust surface.
 */
function newestInboxDays(preview: CompositeActionPreviewResult | undefined): number | null {
  const iso = preview?.recentMessages?.all?.[0]?.date ?? null;
  if (iso === null) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
}

/**
 * `2026-04-12` — ISO-ORDERED but rendered from LOCAL calendar parts, the
 * same convention as `toLocalDateTimeInput` below.
 *
 * Not `toISOString().slice(0,10)`: that prints the UTC day, so a message
 * received at 20:00 PST would show as the NEXT day and disagree with the
 * date Gmail shows the user — an off-by-one on a trust panel whose whole
 * job is letting them verify the set. Ordered YYYY-MM-DD rather than a
 * locale format so it cannot be misread as D/M vs M/D.
 *
 * Returns '' for an unparseable value so the row still renders its
 * subject instead of "Invalid Date" (the BE already drops dateless rows;
 * this is the render-side guard).
 */
function toLocalDateTimeInput(iso: string): string {
  const date = new Date(iso);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}
