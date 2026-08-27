'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { Button, Eyebrow, Kbd, tokens, useFocusTrap } from '@declutrmail/shared';
import {
  buildActionPresentation,
  composeRecoveryFacts,
  countUnsubscribeCapabilities,
  defaultLaterWakeAtIso,
  describeInboxScope,
  inboxScopeNoticeCopy,
  mailLocationCopy,
  tiedWindowNoticeCopy,
  unsubscribeCapabilityBreakdown,
  UNSUBSCRIBE_CAPABILITIES,
  type PresentedAction,
  type UnsubscribeChannel,
} from '@declutrmail/shared/actions';
import { MailboxActionContext } from '@/features/auth/mailbox-action-context';
import { getActiveMailboxEmail, useOptionalAuth } from '@/features/auth/auth-provider';
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
} from './data';

const { color, font } = tokens;

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
   * on a single-sender Delete. Omitted otherwise (the wire default is
   * inbox-only, and the server rejects the value on any other shape).
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
  return verb === 'Delete' ? 180 : null;
}

/**
 * Verb → confirm-button emoji glyph. Spec v1.2 Decision 15 confirm
 * button copy: `📥 Archive 47` / `🗑 Delete 125` / `🚫 Unsubscribe` etc.
 * Kept letter-free per ADR-0019 §3.1 (shortcut chip carries the letter).
 */
const VERB_GLYPH: Partial<Record<ActionVerb, string>> = {
  Archive: '📥',
  Delete: '🗑',
  Unsubscribe: '🚫',
  Later: '⏰',
};

/**
 * The mandatory action preview (D226). No bulk mutation runs without
 * this confirm — it states the current match count before anything
 * happens. Gmail is resolved again by the worker at execution. PR-FE3
 * adds: Delete primary (red tone + 30-day recovery banner), composite
 * secondary chip row on Unsub/Later, "Show what currently matches" expand
 * panel, and per-bucket count preview via the composite endpoint.
 */
export function ConfirmActionModal({
  request,
  onCancel,
  onConfirm,
  compositePreview,
  compositePreviewLoading,
  compositePreviewError,
  bulkPreview,
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

  // ADR-0028 reach. Offered only where the server accepts it — a
  // single-sender Delete — and only when the preview actually carries
  // the all-mail block (`allMail` is null against an API predating the
  // field, so during a deploy skew the choice simply does not appear).
  const reachAvailable = isDeleteVerb && !isBulk && compositePreview?.allMail != null;
  const activeReach: ActionReach = reachAvailable ? reach : 'inbox_only';

  const bucketCounts = isBulk
    ? bulkPreview?.data?.totals
    : activeReach === 'all_mail'
      ? compositePreview?.allMail?.counts
      : compositePreview?.counts;

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

  // D248 — a selection's unsubscribe capability is a PARTITION over four
  // states, never one aggregate. Only `one_click` senders are ones
  // DeclutrMail can unsubscribe; `mailto` stays user-sent (D230),
  // `none` has nothing to send, and `unknown` has not been checked yet.
  // Reported separately because they are different facts, and only one
  // of them is something the user can act on.
  const unsubCapabilities = isUnsubVerb
    ? countUnsubscribeCapabilities((request?.senders ?? []).map((s) => s.unsubscribeMethod))
    : null;
  const unsubBreakdown = unsubCapabilities ? unsubscribeCapabilityBreakdown(unsubCapabilities) : [];
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
  // substitute. Pure Unsubscribe (Leave alone) is the one exception because
  // it does not move existing inbox mail.
  const requiresLivePreview = isArchiveVerb || isLaterVerb || isDeleteVerb || hasSecondaryAction;
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

  // Preview bucket count under the current chip selection — the ONE
  // count source: it feeds the headline, the zero-state gate and (via
  // requestedCount parity server-side) what the worker will move.
  const compositeCount = pickBucketCount(bucketCounts, olderThanDays);
  const previewLoading = isBulk
    ? (bulkPreview?.loading ?? false)
    : Boolean(compositePreviewLoading);

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
  const inboxScopeCopy = inboxScopeVerbLabel
    ? inboxScopeNoticeCopy(
        inboxScopeNotice,
        inboxScopeVerbLabel,
        isBulk ? 'these senders' : 'this sender',
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
    inboxScopeNotice.kind === 'empty-inbox' &&
    reachAvailable &&
    (compositePreview?.allMail?.counts.all ?? 0) > 0
      ? `Switch to "Inbox + archived" to reach ${(
          compositePreview?.allMail?.counts.all ?? 0
        ).toLocaleString('en-US')} archived email${
          (compositePreview?.allMail?.counts.all ?? 0) === 1 ? '' : 's'
        }.`
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
  // line apart. Single-sender only — a bulk preview carries no
  // `allMail` block to split, and inventing one is the failure mode
  // this whole module exists to avoid.
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
  const unitsNeeded =
    unitsPerSender *
    (isBulk
      ? bulkPreview?.data
        ? bulkPreview.data.senders.filter((s) => !s.protected).length
        : (request?.senders.length ?? 0)
      : 1);
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
  const confirmDisabled =
    livePreviewBlocksConfirm ||
    nothingToActOn ||
    wakeAtInvalid ||
    unsubNothingToSend ||
    (quotaShort && !quotaCappedFrom);

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

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !confirmDisabled) {
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
    secondaryVerb,
    olderThanDays,
    reach,
    reachAvailable,
    activeReach,
    wakeAt,
    onCancel,
    onConfirm,
    confirmDisabled,
    showSecondaryRow,
    showWindowRow,
    hasSecondaryAction,
  ]);

  const auth = useOptionalAuth();
  const trapRef = useFocusTrap<HTMLDivElement>(request !== null);

  if (!request) return null;

  const { senders } = request;
  const historic = senders.reduce((sum, s) => sum + s.totalReceived, 0);
  const requestedSenderCount = senders.length;
  const selectedCount = request.selectedCount ?? requestedSenderCount;
  const skippedCount = (request.skipped?.protectedCount ?? 0) + (request.skipped?.peopleCount ?? 0);
  const eligibleCount = Math.max(0, selectedCount - skippedCount);
  // Stated by the caller when known; the old arithmetic is the fallback
  // for the single-sender paths that never narrow.
  const n = request.actionableCount ?? eligibleCount;
  const plural = n === 1 ? '' : 's';
  const subject = n === 1 ? 'this sender' : 'these senders';
  // Tone: Delete is the strongest destructive — red eyebrow + amber-red
  // recovery banner. Unsubscribe reads as destructive too (cuts future
  // mail), but moves no past mail by itself.
  const danger = isUnsubVerb || isDeleteVerb;

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
  });

  const title = isDeleteVerb
    ? `Delete email from ${n} sender${plural}`
    : isArchiveVerb
      ? `Archive email from ${n} sender${plural}`
      : isLaterVerb
        ? `Move ${n} sender${plural} to Later`
        : `Unsubscribe from ${n} sender${plural}`;
  // Both halves go through `actionEffectCopy`. `presentation.secondary`
  // is a `PresentedAction` OBJECT, and the predicate that used to guard
  // this list asserted `copy is string` off a bare `!== null` test — a
  // cast, not a narrowing, so TypeScript never saw the object reach
  // `join` and the modal shipped "Also: [object Object]" on every
  // composite (live, 2026-08-21).
  // `effectCopy` is assembled in `@declutrmail/shared/actions`, which is
  // also where composite suppression lives. This used to be a local
  // re-assembly from the raw semantics fields, so the shared builder
  // could drop a contradicted fact from `previewCopy` while the lead the
  // reader saw kept printing it (founder screenshot 2026-08-27).
  const lead = [presentation.primary, presentation.secondary]
    .filter((action): action is PresentedAction => action !== null)
    .map((action) => action.effectCopy)
    .join(' Also: ');

  const numberStyle: CSSProperties = {
    fontFamily: font.display,
    fontSize: 22,
    fontWeight: 600,
    letterSpacing: '-0.02em',
    color: color.fg,
    fontVariantNumeric: 'tabular-nums',
  };

  // Name the requested action but omit the preview count: Gmail is
  // re-checked at execution, so the affected count can change.
  const confirmLabel = (() => {
    const primaryGlyph = VERB_GLYPH[verb!] ?? '';
    const primaryPart = `${primaryGlyph} ${verbDisplay(verb!).label}`;
    // Name the override in the button itself — the click IS the
    // acknowledgement, so it must not read like an ordinary confirm.
    if (needsProtectedOverride && !hasSecondaryAction) return `${primaryPart} anyway`;
    if (!hasSecondaryAction) return primaryPart;
    const secVerb = secondaryVerb === 'archive' ? 'Archive' : 'Delete';
    const secGlyph = VERB_GLYPH[secVerb] ?? '';
    const secondaryPart = `${secGlyph} ${secVerb}`;
    return `${primaryPart} + ${secondaryPart}`;
  })();

  const recoveryCopy = composeRecoveryFacts(presentation.primary, presentation.secondary).join(' ');

  // Subjects for the "Show what currently matches" panel (spec v1.3 — recent
  // beats oldest for 3-sec sender recognition). Single-sender single-
  // verb path reads top-5 from `compositePreview.recentMessages[bucket]`;
  // falls back to the fixture pool ONLY while the preview is in flight
  // so the panel never blanks during the load flash. Bulk flow (>1
  // sender) hides the panel entirely — per-sender drilldown is a
  // separate ticket.
  //
  // The sample is trimmed to the bucket's REAL total at the source —
  // the fixture pool (and any wire drift) must never offer more rows
  // than the count it previews (live smoke 2026-06-09 saw "5 of 3").
  // 5 stays the display cap (the BE's per-bucket sample size); the
  // disclosure label and the panel rows both read THIS array so the
  // advertised count always equals what expanding shows.
  const subjectsFromWire =
    senders.length === 1
      ? pickBucketSubjects(
          activeReach === 'all_mail'
            ? compositePreview?.allMail?.recentMessages
            : compositePreview?.recentMessages,
          olderThanDays,
        )
      : undefined;
  // Wire subjects ONLY — no fixture fallback. Before the composite
  // preview resolves, `compositeCount` is undefined so the disclosure
  // button below never renders; a fabricated current-match list on
  // the D226 trust surface is worse than none (§10 no-fake-data).
  const subjectsPreview =
    senders.length === 1 ? (subjectsFromWire ?? []).slice(0, Math.min(5, compositeCount ?? 5)) : [];

  // D226 honesty — when the eligibility gate narrowed the selection
  // before this preview opened, say so: the user saw "N selected" in
  // the bar and must not wonder why the sheet covers fewer senders.
  // D — a Gmail search mirroring THIS preview's scope, so the user can
  // eyeball the real messages before confirming. Only when the preview
  // has resolved and only for a single sender (bulk has no one `from:`).
  // Approximate by construction — see `buildActionScopeSearchLink`.
  const verifyInGmailUrl = (() => {
    if (!livePreviewReady || senders.length !== 1) return null;
    const email = mailboxEmail ?? (auth ? getActiveMailboxEmail(auth.me) : null);
    if (!email) return null;
    return GmailOpenLinkService.buildActionScopeSearchLink({
      mailboxEmail: email,
      from: senders[0]!.email,
      olderThanDays: showWindowRow ? olderThanDays : null,
      // ADR-0028 — mirror the selected reach: dropping `in:inbox` makes
      // the Gmail search cover archived mail too (Gmail excludes Trash
      // and Spam from a plain search by default, matching the reach's
      // own exclusions).
      inboxOnly: activeReach !== 'all_mail',
    });
  })();

  const skippedNote = (() => {
    const skipped = request.skipped;
    if (!skipped) return null;
    const parts: string[] = [];
    if (skipped.protectedCount > 0) {
      const p = skipped.protectedCount;
      parts.push(
        `${p} protected sender${p === 1 ? '' : 's'} skipped — unprotect to include ${p === 1 ? 'it' : 'them'}`,
      );
    }
    if (skipped.peopleCount > 0) {
      const q = skipped.peopleCount;
      parts.push(
        `${q === 1 ? '1 person' : `${q} people`} skipped — Unsubscribe doesn't apply to people`,
      );
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  })();

  return (
    <>
      <div
        onClick={onCancel}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(14,20,19,0.45)',
          backdropFilter: 'blur(3px)',
          zIndex: 150,
        }}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dm-confirm-title"
        aria-describedby="dm-confirm-lead"
        style={{
          position: 'fixed',
          top: '12vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(540px, calc(100vw - 32px))',
          maxHeight: '78vh',
          overflow: 'auto',
          background: color.card,
          borderRadius: 14,
          border: `1px solid ${color.border}`,
          boxShadow: '0 24px 60px rgba(14,20,19,0.30)',
          zIndex: 151,
          fontFamily: font.sans,
        }}
      >
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${color.line}` }}>
          <Eyebrow tone={danger ? 'amber' : 'primary'}>Preview · before anything changes</Eyebrow>
          <h2
            id="dm-confirm-title"
            style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.014em', margin: '6px 0 0' }}
          >
            {title}
          </h2>
          {/* Sender context strip (spec v1.2 Decision 15) — facts only:
              domain · monthly volume · last seen · you wrote. */}
          {senders.length === 1 && (
            <div
              style={{
                fontFamily: font.mono,
                fontSize: 11.5,
                color: color.fgMuted,
                margin: '8px 0 0',
                letterSpacing: '0.01em',
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
                alignItems: 'baseline',
              }}
            >
              <span style={{ color: color.fgSoft }}>
                {compositePreview?.sender?.domain ?? senders[0]!.domain}
              </span>
              <span>·</span>
              {/* The senders card's own two arrival facts, from the same
                  row and in the same words — "N in last 90d · N received"
                  (sender-card.tsx). This slot used to render "N /mo
                  arriving" off a 30-day count the preview endpoint
                  computed just for it, so the card said "396 in last 90d"
                  and the modal one click later said "134 /mo" for the same
                  sender — both correct, neither naming its window (founder
                  report 2026-08-21). ADR-0037 retired "/mo" everywhere
                  else for exactly this reason. INBOX-now is deliberately
                  NOT repeated here: the chip row below is that number,
                  live, and a second copy could disagree with it. Unknown
                  volume renders "—", never a factual 0 (finding 5.15). */}
              <span>
                <strong style={{ color: color.fg, fontFamily: font.sans, fontWeight: 600 }}>
                  {senders[0]!.monthlyVolume?.toLocaleString('en-US') ?? '—'}
                </strong>{' '}
                in last 90d
              </span>
              <span>·</span>
              <span>
                <strong style={{ color: color.fg, fontFamily: font.sans, fontWeight: 600 }}>
                  {senders[0]!.totalReceived.toLocaleString('en-US')}
                </strong>{' '}
                received
              </span>
              <span>·</span>
              <span>
                last seen{' '}
                <strong style={{ color: color.fg, fontFamily: font.sans, fontWeight: 600 }}>
                  {(() => {
                    const days = compositePreview?.sender?.lastSeenDays ?? senders[0]!.lastDays;
                    return days === 0 ? 'today' : `${days}d`;
                  })()}
                </strong>
              </span>
              {(() => {
                const r = compositePreview?.sender?.wroteToCount ?? senders[0]!.wroteToCount;
                if (r === undefined || r === null || r === 0) return null;
                return (
                  <>
                    <span>·</span>
                    <span>
                      you wrote{' '}
                      <strong style={{ color: color.fg, fontFamily: font.sans, fontWeight: 600 }}>
                        {r}×
                      </strong>
                    </span>
                  </>
                );
              })()}
            </div>
          )}
          <p
            id="dm-confirm-lead"
            style={{ fontSize: 13, color: color.fgSoft, margin: '10px 0 0', lineHeight: 1.5 }}
          >
            {lead}
          </p>
          {/* D248 — the per-state split, never one aggregate number. It
              is the last reversible moment: a delivered unsubscribe
              cannot be recalled (D58), so what will and will not be
              sent has to be legible here. */}
          {unsubBreakdown.length > 0 && (
            <div
              aria-label="Unsubscribe breakdown"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '4px 8px',
                margin: '10px 0 0',
                fontFamily: font.mono,
                fontSize: 11,
                color: color.fgMuted,
                letterSpacing: '0.02em',
              }}
            >
              {unsubBreakdown.map((line, index) => (
                <span key={line} style={{ display: 'inline-flex', gap: '4px 8px' }}>
                  {index > 0 && <span aria-hidden="true">·</span>}
                  <span style={index === 0 ? { color: color.fgSoft } : undefined}>{line}</span>
                </span>
              ))}
            </div>
          )}
          {unsubNothingToSend && (
            <p
              role="note"
              style={{ fontSize: 12, color: color.fgSoft, margin: '8px 0 0', lineHeight: 1.5 }}
            >
              No sendable unsubscribe for these senders. Archive moves their email out of your inbox
              instead.
            </p>
          )}
          {skippedNote && (
            <p
              style={{
                fontFamily: font.mono,
                fontSize: 10.5,
                color: color.fgMuted,
                letterSpacing: '0.04em',
                margin: '8px 0 0',
              }}
            >
              {skippedNote}
            </p>
          )}
          {request.selectedCount !== undefined && (selectedCount > 1 || skippedCount > 0) && (
            <p
              aria-label="Senders included in this bulk action"
              style={{
                fontFamily: font.mono,
                fontSize: 10.5,
                color: color.fgMuted,
                letterSpacing: '0.04em',
                margin: '8px 0 0',
              }}
            >
              {/* The quota segment is what reconciles "eligible" with the
                  title once a cap is in play: 2 senders can be eligible
                  while only 1 fits this month's allowance. Without it the
                  line reads as an unexplained mismatch. */}
              {selectedCount} selected · {eligibleCount} eligible · {skippedCount} skipped
              {quotaCappedFrom ? ` · ${requestedSenderCount} within this month's actions` : ''}
            </p>
          )}
        </div>

        {/* Protected acknowledgement (D245 / D42). The sender is Protected
            and this is an explicit single-sender action, so the path stays
            open — but the user is told, in the mandatory preview, before
            the click that carries `override`. Protection is usually
            AUTOMATIC (≥3 replies, a star, or repeated Gmail-importance),
            so the user may not know they set it; naming it is the point. */}
        {needsProtectedOverride && (
          <div
            role="status"
            style={{
              margin: '12px 24px 0',
              padding: '8px 12px',
              borderRadius: 8,
              background: 'rgba(196,46,46,0.06)',
              border: `1px solid rgba(196,46,46,0.30)`,
              fontFamily: font.sans,
              fontSize: 12,
              color: color.danger,
            }}
          >
            This sender is <strong>Protected</strong> — it is normally kept out of bulk and
            automatic actions. This action applies to this sender only.
          </div>
        )}

        {/* Recovery copy is generated from the canonical semantics for
            both primary and optional secondary actions. */}
        {recoveryCopy && (
          <div
            role="status"
            style={{
              margin: '12px 24px 0',
              padding: '8px 12px',
              borderRadius: 8,
              background: isDeleteVerb ? 'rgba(196,46,46,0.06)' : color.paper,
              border: `1px solid ${isDeleteVerb ? 'rgba(196,46,46,0.30)' : color.line}`,
              fontSize: 12,
              color: isDeleteVerb ? color.danger : color.fgSoft,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span aria-hidden style={{ fontSize: 13 }}>
              ⏱
            </span>
            <span>{recoveryCopy}</span>
          </div>
        )}

        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <MailboxActionContext mailboxEmail={mailboxEmail} />
          {isLaterVerb && wakeAt !== null && (
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                fontSize: 12.5,
                color: color.fgSoft,
              }}
            >
              <span style={{ fontWeight: 600, color: color.fg }}>Return to Inbox</span>
              <input
                type="datetime-local"
                value={toLocalDateTimeInput(wakeAt)}
                min={toLocalDateTimeInput(new Date(Date.now() + 60_000).toISOString())}
                onChange={(event) => {
                  const next = new Date(event.currentTarget.value);
                  setWakeAt(Number.isNaN(next.getTime()) ? null : next.toISOString());
                }}
                aria-label="Later return time"
                style={{
                  border: `1px solid ${color.line}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                  background: color.card,
                  color: color.fg,
                  fontFamily: font.sans,
                  fontSize: 13,
                }}
              />
            </label>
          )}
          {/* Per-sender breakdown (D52) — each lozenge carries the REAL
              count for the active time-window from the aggregated
              preview; protected senders are flagged (the BE skips them).
              The "+N more" toggle expands the full list for verification. */}
          {senders.length > 1 &&
            (() => {
              const breakdownById = new Map(
                (bulkPreview?.data?.senders ?? []).map((s) => [s.senderId, s] as const),
              );
              const visible = showAllSenders ? senders : senders.slice(0, 6);
              const protectedCount = bulkPreview?.data?.protectedCount ?? 0;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 6,
                    }}
                  >
                    {visible.map((s) => {
                      const row = breakdownById.get(s.id);
                      const n = row ? pickBucketCount(row.counts, olderThanDays) : undefined;
                      return (
                        <span
                          key={s.id}
                          style={{
                            fontFamily: font.mono,
                            fontSize: 11,
                            color: color.fgSoft,
                            background: color.paper,
                            border: `1px solid ${color.line}`,
                            borderRadius: 6,
                            padding: '3px 8px',
                          }}
                        >
                          {s.name}
                          {row?.protected ? (
                            <span style={{ color: color.fgMuted }}> · protected</span>
                          ) : (
                            n !== undefined && (
                              <span
                                style={{
                                  color: color.fg,
                                  fontVariantNumeric: 'tabular-nums',
                                }}
                              >
                                {' '}
                                · {n.toLocaleString('en-US')}
                              </span>
                            )
                          )}
                        </span>
                      );
                    })}
                    {senders.length > 6 && (
                      <button
                        type="button"
                        onClick={() => setShowAllSenders((v) => !v)}
                        aria-expanded={showAllSenders}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          fontFamily: font.mono,
                          fontSize: 11,
                          color: color.fgMuted,
                          alignSelf: 'center',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {showAllSenders ? 'show fewer ▴' : `+${senders.length - 6} more ▾`}
                      </button>
                    )}
                  </div>
                  {protectedCount > 0 && (
                    <span
                      style={{
                        fontFamily: font.mono,
                        fontSize: 10.5,
                        color: color.fgMuted,
                        letterSpacing: '0.04em',
                      }}
                    >
                      {protectedCount} protected sender{protectedCount === 1 ? '' : 's'} won&apos;t
                      be touched.
                    </span>
                  )}
                </div>
              );
            })()}

          {/* ADR-0028 reach chip pair — Delete only. Rendered even when
              the window chips are suppressed for an empty inbox: it is
              exactly then that "Inbox + archived" is the escape hatch. */}
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
                    { value: 'inbox_only', label: 'Inbox only' },
                    { value: 'all_mail', label: 'Inbox + archived' },
                  ] as const satisfies ReadonlyArray<{ value: ActionReach; label: string }>
                ).map((opt) => {
                  const active = activeReach === opt.value;
                  const optCounts =
                    opt.value === 'all_mail'
                      ? compositePreview?.allMail?.counts
                      : compositePreview?.counts;
                  // Window-scoped only while the window row is VISIBLE.
                  // With the chips suppressed (empty inbox) a hidden
                  // 180d default would put an unexplained smaller figure
                  // on the pair — live smoke 2026-07-28 read "reach 977
                  // archived emails" beside a chip saying 933.
                  const optCount = pickBucketCount(
                    optCounts,
                    showWindowChips ? olderThanDays : null,
                  );
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => {
                        // Clicking a chip that advertised its
                        // UN-WINDOWED count (the window row was hidden
                        // for an empty inbox) must arm exactly that
                        // number — so the window resets to "All mail"
                        // instead of a hidden 180d default silently
                        // shaving the figure the user just chose
                        // (design-system gate, 2026-07-28).
                        if (opt.value === 'all_mail' && !showWindowChips) {
                          setOlderThanDays(null);
                        }
                        setReach(opt.value);
                      }}
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
                      {optCount !== undefined && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontVariantNumeric: 'tabular-nums',
                            opacity: active ? 0.85 : 0.7,
                          }}
                        >
                          {optCount.toLocaleString('en-US')}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {activeReach === 'all_mail' && (
                <span style={{ fontSize: 11.5, color: color.fgMuted, lineHeight: 1.45 }}>
                  Includes archived mail. Trash, Spam, Drafts and Chat are never touched. Undo
                  restores every email — inbox email to the inbox, archived email to the archive.
                </span>
              )}
            </div>
          )}

          {/* Time-window chip row (spec v1.2 Decision 15). Visible when
              the action acts on historic mail — Archive/Delete primary
              OR the active secondary historic action. */}
          {showWindowChips && (
            <div
              role="radiogroup"
              aria-label="How far back to act on"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
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
                How far back
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                }}
              >
                {TIME_WINDOW_PRESETS.map((preset) => {
                  const active = olderThanDays === preset.days;
                  const bucketCount = pickBucketCount(bucketCounts, preset.days);
                  // "All inbox" is a lie once the reach covers archived
                  // mail — rename the un-windowed chip to match scope.
                  const label =
                    preset.days === null && activeReach === 'all_mail' ? 'All mail' : preset.label;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setOlderThanDays(preset.days)}
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
                      {label}
                      {bucketCount !== undefined && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontVariantNumeric: 'tabular-nums',
                            opacity: active ? 0.85 : 0.7,
                          }}
                        >
                          {bucketCount.toLocaleString('en-US')}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {tiedWindowCopy && (
                <span style={{ fontSize: 11.5, color: color.fgMuted, lineHeight: 1.45 }}>
                  {tiedWindowCopy}
                </span>
              )}
            </div>
          )}

          {/* Composite secondary chip row (spec v1.2 Decision 15). Shown
              for Unsub + Later primary — "ALSO ACT ON PAST EMAILS":
              [Leave alone | Archive them | Delete them]. */}
          {showSecondaryRow && (
            <div
              role="radiogroup"
              aria-label="Also act on past emails"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
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
                Also act on past emails
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(
                  [
                    { value: null as ConfirmSecondaryVerb, label: 'Leave alone' },
                    { value: 'archive' as ConfirmSecondaryVerb, label: 'Archive them' },
                    { value: 'delete' as ConfirmSecondaryVerb, label: 'Delete them' },
                  ] as const
                ).map((opt) => {
                  const active = secondaryVerb === opt.value;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setSecondaryVerb(opt.value)}
                      style={{
                        fontFamily: font.sans,
                        fontSize: 12.5,
                        fontWeight: 500,
                        padding: '6px 12px',
                        borderRadius: 999,
                        background: active
                          ? opt.value === 'delete'
                            ? color.danger
                            : color.fg
                          : 'transparent',
                        color: active ? color.fgInverse : color.fgSoft,
                        border: `1px solid ${active ? (opt.value === 'delete' ? color.danger : color.fg) : color.line}`,
                        cursor: 'pointer',
                        transition: 'background 120ms, color 120ms',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {isUnsubVerb && (
                <span style={{ fontSize: 11.5, color: color.fgMuted }}>
                  Archiving or deleting past email uses a second cleanup action.
                </span>
              )}
            </div>
          )}

          {/* Current-match summary + subject sample (spec v1.2 Decision 15).

              Hidden entirely for an Unsubscribe with the backlog left
              alone: that action moves no mail, so a panel counting what
              "currently matches" — and offering a Gmail search and a
              subject sample over it — invites the reader to inspect mail
              nothing is going to touch. It shipped reading "Show what
              currently matches (5 of 17)" under an action whose own lead
              said existing email stays where it is (founder screenshot
              2026-08-27). */}
          {!unsubscribeMovesNothing && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: '12px 14px',
                background: color.paper,
                border: `1px solid ${color.line}`,
                borderRadius: 9,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                {(() => {
                  if (livePreviewUnavailable) {
                    return (
                      <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                        {previewSenderGone
                          ? 'This sender is no longer in this mailbox — the list you are looking at is out of date. Refresh to see what is there now.'
                          : 'Couldn’t load a live preview. Close and retry — no inbox email can move without one.'}
                      </span>
                    );
                  }
                  if (livePreviewLoading) {
                    return (
                      <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                        Loading the live preview… Confirm unlocks when it is ready.
                      </span>
                    );
                  }
                  // Headline figure resolution order:
                  //   1. composite per-bucket count (the one count source)
                  //   2. fallback qualitative copy while it resolves
                  if (compositeCount !== undefined) {
                    if (primaryActsOnInbox) {
                      return (
                        <>
                          <strong style={numberStyle}>
                            {compositeCount.toLocaleString('en-US')}
                          </strong>
                          <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                            email{compositeCount === 1 ? '' : 's'} currently match
                            {activeReach === 'all_mail' ? ' across inbox + archived' : ''}
                            {showWindowQualifier
                              ? ` (older than ${olderThanDays} day${olderThanDays === 1 ? '' : 's'})`
                              : ''}
                            {isDeleteVerb
                              ? ' for Trash.'
                              : isLaterVerb
                                ? ' for Later.'
                                : ' for Archive.'}
                          </span>
                        </>
                      );
                    }
                    if (hasSecondaryAction) {
                      return (
                        <>
                          <strong style={numberStyle}>
                            {compositeCount.toLocaleString('en-US')}
                          </strong>
                          <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                            email{compositeCount === 1 ? '' : 's'} currently match for{' '}
                            {secondaryVerb === 'delete' ? 'Trash' : 'Archive'}
                            {showWindowQualifier
                              ? ` (older than ${olderThanDays} day${olderThanDays === 1 ? '' : 's'})`
                              : ''}
                            .
                          </span>
                        </>
                      );
                    }
                  }
                  if (previewLoading) {
                    return (
                      <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                        Checking how much mail from {subject} is in your inbox…
                      </span>
                    );
                  }
                  if (isLaterVerb) {
                    return (
                      <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                        {presentation.primary.currentMail.summary}{' '}
                        {presentation.primary.schedule.kind === 'scheduled'
                          ? presentation.primary.schedule.summary
                          : presentation.primary.schedule.kind === 'required'
                            ? presentation.primary.schedule.summary
                            : null}
                      </span>
                    );
                  }
                  if (historic != null) {
                    return (
                      <>
                        <strong style={numberStyle}>{historic.toLocaleString('en-US')}</strong>
                        <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                          email{historic === 1 ? '' : 's'} received from {subject} in total.
                        </span>
                      </>
                    );
                  }
                  return (
                    <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                      Only email in your inbox.
                    </span>
                  );
                })()}
              </div>

              {/* Why a true count can still read as a contradiction — see
                `describeInboxScope`. Rendered as a status so a screen
                reader hears the reconciliation, not just the bare 0. */}
              {inboxScopeCopy && (
                <span role="status" style={{ fontSize: 12, color: color.fgSoft, lineHeight: 1.45 }}>
                  {inboxScopeCopy}
                  {archivedReachHint ? ` ${archivedReachHint}` : ''}
                </span>
              )}

              {/* Where the sender's mail actually is — both counts from the
                one composite preview, so the split cannot drift. */}
              {mailLocationLine && (
                <span
                  role="status"
                  data-testid="mail-location-line"
                  style={{ fontSize: 12, color: color.fgSoft, lineHeight: 1.45 }}
                >
                  {mailLocationLine}
                </span>
              )}

              {livePreviewReady && (
                <span style={{ fontSize: 11.5, color: color.fgMuted, lineHeight: 1.45 }}>
                  Rechecked when it runs, so the final count can differ from this preview.
                </span>
              )}

              {/* D — let the reader verify the real set in Gmail BEFORE
                confirming. Single-sender only: a bulk sheet has no one
                `from:` to search. The copy says "roughly" on purpose —
                Gmail's `older_than:` is day-granular and resolves live,
                so its result count can differ from the preview's exact
                `internal_date` filter. Never claim the two match. */}
              {verifyInGmailUrl && (
                <a
                  href={verifyInGmailUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    alignSelf: 'flex-start',
                    fontFamily: font.mono,
                    fontSize: 11,
                    letterSpacing: '0.04em',
                    color: color.fgSoft,
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                  title="Opens a Gmail search roughly matching this preview. Gmail filters by whole days and searches live, so its count can differ slightly."
                >
                  Check these in Gmail first ↗
                </a>
              )}

              {/* Current matches (5 of N) ▾ — privacy-safe subjects panel.
                Only shown for single-sender flows where the "subjects pool"
                stub is meaningful; bulk flows would need a per-sender
                drilldown that lands separately. */}
              {senders.length === 1 && (compositeCount ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => setShowSubjects((v) => !v)}
                  aria-expanded={showSubjects}
                  style={{
                    alignSelf: 'flex-start',
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    fontFamily: font.mono,
                    fontSize: 11,
                    color: color.fgMuted,
                    letterSpacing: '0.04em',
                  }}
                >
                  {showSubjects
                    ? 'Hide current matches ▴'
                    : `Show what currently matches (${subjectsPreview.length.toLocaleString('en-US')} of ${(compositeCount ?? 0).toLocaleString('en-US')}) ▾`}
                </button>
              )}
              {showSubjects && subjectsPreview.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    padding: '8px 10px',
                    background: color.card,
                    border: `1px solid ${color.line}`,
                    borderRadius: 6,
                    marginTop: 4,
                  }}
                >
                  {/* Date first: on a windowed action this sample is the 5
                    most recent WITHIN the bucket, and the date is how the
                    reader checks it respects the window they picked. */}
                  {subjectsPreview.map((s, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'baseline',
                        fontFamily: font.mono,
                        fontSize: 11.5,
                        color: color.fgSoft,
                      }}
                    >
                      <span style={{ width: 18, color: color.fgMuted }}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
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
                  <div
                    style={{
                      marginTop: 6,
                      paddingTop: 6,
                      borderTop: `1px dashed ${color.line}`,
                      fontFamily: font.mono,
                      fontSize: 10.5,
                      color: color.fgMuted,
                      letterSpacing: '0.04em',
                    }}
                  >
                    Subjects only · we never fetch or store full email contents
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 24px 18px',
            borderTop: `1px solid ${color.line}`,
          }}
        >
          <span
            style={{
              fontSize: 11.5,
              color: livePreviewBlocksConfirm ? color.amber : color.fgMuted,
              fontWeight: livePreviewBlocksConfirm ? 600 : 400,
            }}
          >
            {livePreviewUnavailable
              ? previewSenderGone
                ? 'This sender is no longer in this mailbox — nothing can be previewed or moved.'
                : "Couldn't load the live preview — close and retry before confirming."
              : livePreviewLoading
                ? 'Loading the live preview — confirm stays locked until it is ready.'
                : quotaCappedFrom
                  ? `${unitsNeeded} of ${quotaCappedFrom} eligible senders — every cleanup action you have left this month. The rest stay untouched.`
                  : quotaShort
                    ? `This needs ${unitsNeeded} cleanup action${unitsNeeded === 1 ? '' : 's'} but only ${quotaRemaining} ${quotaRemaining === 1 ? 'is' : 'are'} left this month.`
                    : quotaRemaining !== null
                      ? `Uses ${unitsNeeded} of your ${quotaRemaining} cleanup action${quotaRemaining === 1 ? '' : 's'} left this month.`
                      : ''}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {livePreviewUnavailable &&
              (previewSenderGone
                ? onRefreshSenders && (
                    <Button tone="default" onClick={onRefreshSenders}>
                      Refresh senders
                    </Button>
                  )
                : onRetryPreview && (
                    <Button tone="default" onClick={onRetryPreview}>
                      Retry preview
                    </Button>
                  ))}
            <Button
              tone="default"
              onClick={onCancel}
              iconRight={<Kbd style={{ fontSize: 9, color: color.fgMuted }}>Esc</Kbd>}
            >
              Cancel
            </Button>
            {quotaShort ? (
              <Button tone="primary" onClick={reportQuotaShort}>
                Upgrade for unlimited cleanup
              </Button>
            ) : (
              <Button
                // Delete-tone CTA fill is one of the three sanctioned
                // `color.danger` uses (ADR-0019 §accent) — amber stays
                // Unsubscribe's tone (ADR-0016 A5).
                tone={isDeleteVerb ? 'danger' : danger ? 'warn' : 'primary'}
                disabled={confirmDisabled}
                onClick={() => onConfirm(buildConfirmOpts())}
                iconRight={
                  <Kbd
                    style={{
                      background: color.lineInverse,
                      border: 'none',
                      color: color.fgInverse,
                    }}
                  >
                    ⌘⏎
                  </Kbd>
                }
              >
                {confirmLabel}
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
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
