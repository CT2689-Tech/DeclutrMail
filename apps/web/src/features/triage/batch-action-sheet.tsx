'use client';

import { useEffect, type CSSProperties, type ReactNode } from 'react';
import {
  Avatar,
  Button,
  PreviewSheet,
  SheetFactList,
  tokens,
  type SheetFactItem,
} from '@declutrmail/shared';
import { buildActionPresentation } from '@declutrmail/shared/actions';
import type { BulkActionPreviewResult } from '@/lib/api/use-action';

import { afterLead } from '@/lib/copy/after-lead';
import type { TriageDecisionRow } from './data';
import type { DomainBatch } from './domain-batch';
import type { BatchVerb } from './domain-batch-card';

const { color, radius, space } = tokens;

/**
 * Batch action sheet — the D226-mandatory preview for a domain-batch
 * decision, over the AGGREGATED bulk preview (`POST
 * /api/actions/preview/bulk`): the total that will actually move, the
 * per-sender breakdown, and the protected senders the enqueue will skip.
 * The confirm fires ONE composite `POST /api/actions` with the senders
 * selector (ADR-0020) — one batch, one cascade undo token.
 *
 * Layout is the shared `PreviewSheet` (ADR-0042), in the same grammar as
 * the senders bulk sheet: the count in the title, where the email goes in
 * the subtitle, how to undo it in the note — each once — and the
 * per-sender list plus every other fact behind "Details". Esc, the
 * backdrop and focus are the sheet's; ⌘⏎ confirms here.
 *
 * No remember-preference toggle here: D34's skip-sheet path is a
 * per-verb single-row ergonomic; a multi-sender batch always shows
 * its sheet.
 */
export function BatchActionSheet({
  open,
  verb,
  batch,
  preview,
  wakeAt = null,
  mailboxEmail,
  onCancel,
  onConfirm,
  onRetryPreview,
  onRefreshTriage,
  quotaRemaining,
}: {
  open: boolean;
  verb: BatchVerb;
  batch: DomainBatch | null;
  /** Aggregated preview — `'loading'` while loading, `'unavailable'` on failure. */
  preview: BulkActionPreviewResult | 'loading' | 'unavailable';
  /** Exact Later return time carried through confirmation. */
  wakeAt?: string | null;
  /** Explicit override for isolated previews; app surfaces use active auth context. */
  mailboxEmail?: string | undefined;
  onCancel: () => void;
  onConfirm: () => void;
  onRetryPreview?: (() => void) | undefined;
  /** Route out of the zero-actionable dead end — same control as the single sheet. */
  onRefreshTriage?: (() => void) | undefined;
  /**
   * Cleanup actions left this month; `null` on an unmetered tier.
   *
   * A domain batch is the largest spend reachable from Triage — one
   * action per eligible sender — and stated no cost at all. Its own
   * `onError` in `triage-screen.tsx` catches 402 FREE_CAP_REACHED, so
   * the cap was known to be reachable from here; the preview simply
   * never said so before the click (Codex stop-time review 2026-08-27).
   */
  quotaRemaining?: number | null | undefined;
}) {
  const wakeAtInvalid = verb === 'Later' && (wakeAt === null || Date.parse(wakeAt) <= Date.now());
  // Computed before the early-return guard below (`batch` can still be
  // null here) so the ⌘⏎ handler registered by the hook right after —
  // which must run on every render — can gate on it too. Codex review
  // 2026-09-03 round 2: the live preview can legitimately resolve to
  // zero actionable senders (every queued one went Protected or was
  // deleted since queuing); without this, confirm stayed enabled and
  // `enqueueBulkComposite` rejected the empty set after the sheet closed.
  //
  // `batch.eligibleRows` is the queue snapshot taken before the bulk
  // preview ran; the preview independently re-resolves each id and can
  // drop it (deleted since queued) or flag it newly Protected —
  // `enqueueBulkComposite` repeats that same resolution. Once loaded, the
  // preview's `senders` list is the authoritative actionable set, so the
  // title, the quota line and the confirm all name the count the click
  // actually commits to (QA-archive-20260901-01).
  const actionableCount =
    batch == null
      ? 0
      : typeof preview === 'object'
        ? preview.senders.filter((s) => !s.protected).length
        : batch.eligibleRows.length;
  const nothingActionable = typeof preview === 'object' && actionableCount === 0;
  // Senders are actionable but none has email in the inbox: both batch
  // verbs only move inbox email, so confirming is a no-op that still costs
  // cleanup actions on Free. The single-sender sheet refuses the same case
  // (`nothingToActOn` in action-sheet.tsx).
  const nothingToMove =
    typeof preview === 'object' && !nothingActionable && preview.totals.all === 0;
  const confirmDisabled =
    preview === 'loading' ||
    preview === 'unavailable' ||
    wakeAtInvalid ||
    nothingActionable ||
    nothingToMove;
  // ⌘⏎ confirms. Esc, the backdrop and initial focus are `PreviewSheet`'s.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !confirmDisabled) {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onConfirm, confirmDisabled]);

  if (!open || !batch) return null;

  const unitsNeeded = actionableCount;
  const quotaShort = quotaRemaining != null && unitsNeeded > quotaRemaining;
  const loaded = typeof preview === 'object' ? preview : null;
  const total = loaded === null ? null : loaded.totals.all;
  const presentation = buildActionPresentation({
    verb: verb === 'Archive' ? 'archive' : 'later',
    liveCount: total,
    planUndoDeadline: null,
    wakeAt: verb === 'Later' ? wakeAt : null,
    unsubscribeChannel: null,
    // Absolute times render in the reader's own clock: every one of
    // these surfaces is opened by a click, never server-rendered.
    timeZone: 'viewer',
  });
  const { primary } = presentation;
  const who = sendersLabel(actionableCount);

  // ── The count (title) ────────────────────────────────────────────────
  const title = nothingActionable
    ? 'No senders left to act on'
    : nothingToMove
      ? 'Nothing in your inbox from these senders'
      : verb === 'Archive'
        ? total === null
          ? `Archive email from ${who}?`
          : `Archive ${emailsLabel(total)} from ${who}?`
        : total === null
          ? `Move email from ${who} to Later?`
          : `Move ${emailsLabel(total)} from ${who} to Later?`;

  // ── Where it goes (subtitle) ─────────────────────────────────────────
  const destination =
    verb === 'Archive'
      ? 'They leave your inbox and stay in Gmail.'
      : 'They wait in Gmail’s DeclutrMail/Later label, then return to your inbox.';
  const subtitle =
    nothingActionable || nothingToMove ? null : `From ${batch.domain}. ${destination}`;

  // ── How to undo it (note) + Protected senders skipped, said once ─────
  const protectedCount = loaded?.protectedCount ?? 0;
  const skipSentence =
    protectedCount > 0
      ? `${protectedCount} Protected sender${protectedCount === 1 ? ' is' : 's are'} skipped.`
      : null;
  const undoNote =
    nothingActionable || nothingToMove
      ? null
      : [
          primary.activityUndo.summary,
          ...(primary.bulkReturnNotice === null ? [] : [primary.bulkReturnNotice]),
        ].join(' ');
  const note = [undoNote, skipSentence].filter((s): s is string => s !== null).join(' ');

  // ── Status: why confirm is unavailable, and the way out ──────────────
  const status: ReactNode = wakeAtInvalid ? (
    'Choose a future return time before confirming Later.'
  ) : preview === 'loading' ? (
    'Counting the inbox…'
  ) : preview === 'unavailable' ? (
    <StatusWithAction
      message="Couldn’t load the preview. Nothing can move until it loads."
      action={onRetryPreview ? { label: 'Retry preview', onClick: onRetryPreview } : undefined}
    />
  ) : nothingActionable ? (
    <StatusWithAction
      message="Every sender here is now Protected or gone."
      action={onRefreshTriage ? { label: 'Refresh triage', onClick: onRefreshTriage } : undefined}
    />
  ) : null;

  // A sheet that cannot run has nothing to charge — the status is the reason.
  const quotaLine =
    quotaRemaining == null || confirmDisabled
      ? null
      : quotaShort
        ? `This needs ${fmt(unitsNeeded)} cleanup action${unitsNeeded === 1 ? '' : 's'} but only ${fmt(quotaRemaining)} ${quotaRemaining === 1 ? 'is' : 'are'} left this month.`
        : `Uses ${fmt(unitsNeeded)} of your ${fmt(quotaRemaining)} cleanup action${quotaRemaining === 1 ? '' : 's'} left this month.`;

  // ── Details ──────────────────────────────────────────────────────────
  const facts: SheetFactItem[] = [];
  if (mailboxEmail) {
    facts.push({
      label: 'Gmail account',
      value: (
        <span role="note" aria-label={`Gmail account: ${mailboxEmail}`}>
          {mailboxEmail}
        </span>
      ),
    });
  }
  if (total !== null && total > 0) {
    facts.push({ label: 'Count', value: 'Inbox now, rechecked when it runs' });
  }
  if (primary.schedule.kind === 'scheduled') {
    facts.push({
      label: 'Returns',
      value: afterLead(primary.schedule.summary, 'Returns to Inbox '),
    });
  }
  if (!nothingActionable && !nothingToMove) {
    facts.push({ label: 'Undo', value: 'One undo reverses the whole batch' });
  }

  const details = (
    <>
      {/* Per-sender breakdown (D52) — FIRST: each row carries the REAL
          count from the aggregated preview; Protected senders are flagged
          (the enqueue skips them). */}
      {loaded !== null && loaded.senders.length > 0 && (
        <div role="list" aria-label="Current per-sender matches" style={senderListStyle}>
          {loaded.senders.map((s) => (
            <div key={s.senderId} role="listitem" style={senderRowStyle}>
              <span style={{ fontWeight: 500, minWidth: 0, overflowWrap: 'anywhere' }}>
                {s.name}
              </span>
              {s.protected ? (
                <span style={{ color: color.fgMuted }}>Protected</span>
              ) : (
                <span style={countStyle}>{fmt(s.counts.all)}</span>
              )}
            </div>
          ))}
        </div>
      )}
      <SheetFactList facts={facts} />
    </>
  );

  const verbWord = verb === 'Archive' ? 'Archive' : 'Later';
  const primaryLabel = total !== null && total > 0 ? `${verbWord} ${fmt(total)}` : verbWord;

  return (
    // Stacking context above the phone selection FAB, as the previous
    // overlay was; `PreviewSheet` itself is fixed to the viewport.
    <div
      role="region"
      aria-label={`Preview · ${verb} ${batch.domain}`}
      data-dm-preview-mode="modal"
      style={{ position: 'relative', zIndex: 151 }}
    >
      <PreviewSheet
        onClose={onCancel}
        testId="triage-batch-sheet"
        icon={
          <AvatarStack rows={batch.eligibleRows.length > 0 ? batch.eligibleRows : batch.rows} />
        }
        title={title}
        subtitle={subtitle ?? undefined}
        note={note === '' ? undefined : note}
        details={details}
        primary={{
          label: primaryLabel,
          onClick: onConfirm,
          tone: 'primary',
          disabled: confirmDisabled,
        }}
        status={status ?? undefined}
        footer={
          quotaLine === null ? undefined : (
            <span style={quotaShort ? { color: color.amber, fontWeight: 600 } : undefined}>
              {quotaLine}
            </span>
          )
        }
      />
    </div>
  );
}

const fmt = (value: number) => value.toLocaleString('en-US');
const emailsLabel = (count: number) => `${fmt(count)} email${count === 1 ? '' : 's'}`;
const sendersLabel = (count: number) => `${fmt(count)} sender${count === 1 ? '' : 's'}`;

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

const countStyle: CSSProperties = {
  color: color.fg,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  flexShrink: 0,
};

/** Up to three overlapping sender logos — the icon of a batch sheet. */
function AvatarStack({ rows }: { rows: readonly TriageDecisionRow[] }) {
  const shown = rows.slice(0, 3);
  return (
    <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center' }}>
      {shown.map((r, i) => (
        <span
          key={r.id}
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
          <Avatar name={r.senderName} domain={r.senderDomain} size={52} hasMark={r.brandMark} />
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
