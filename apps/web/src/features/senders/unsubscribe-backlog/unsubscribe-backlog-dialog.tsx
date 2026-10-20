'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';

import {
  Avatar,
  Button,
  PreviewSheet,
  SheetFactList,
  tokens,
  type SheetFactItem,
} from '@declutrmail/shared';
import {
  PREVIEW_DETAILS,
  normalizeProtectionReason,
  previewIncludesValue,
  protectionReasonClause,
} from '@declutrmail/shared/copy';
import {
  fillCopy,
  isPluralCopy,
  pluralCopy,
  WS2_COPY,
  WS5_COPY,
} from '@declutrmail/shared/copy/launch';

import { MeterPreviewLine } from '@/features/billing/meter-preview-line';
import {
  allProtectedSelectionCopy,
  bulkUnsubscribeTitle,
  someProtectedSelectionCopy,
  unsubscribeButton,
  unsubscribeTitle,
} from './preview-copy';
import { useCleanupSummary } from '@/features/billing/use-cleanup-summary';
import { getActiveMailboxEmail, useOptionalAuth } from '@/features/auth/auth-provider';
import { MailboxActionContextView } from '@/features/auth/mailbox-action-context-view';
import { track } from '@/lib/posthog';
import type { CompositeActionPreviewResult } from '@/lib/api/use-action';

import {
  CleanupPreview,
  UnsubscribeChoices,
  UnsubscribeImpact,
} from '@/components/cleanup-preview';
import { DEFAULT_DELETE_WINDOW_DAYS } from '@declutrmail/shared/actions';
import type { ActionRequest } from '../data';
import { ActionReachControl, DELETE_ARCHIVED_HINT } from '@/components/action-scope-controls';
import {
  pickBucketCount,
  sumBucketCounts,
  TIME_WINDOW_PRESETS,
  type ActionWindowCounts,
} from '../action-window';

/** Synthetic snapshots only; signed-in callers use fresh server previews. */
export type UnsubscribeSnapshotCounts = {
  inbox: ActionWindowCounts;
  allMail?: ActionWindowCounts;
};

export type UnsubscribeBacklogOptions = {
  secondary: { type: 'archive' | 'delete'; olderThanDays: number | null } | null;
  archiveHistoric: boolean;
  /** Set only by the explicit "anyway" click on a Protected sender. */
  override?: boolean;
  reach?: 'all_mail';
  /** Senders named by the preview, including future-only unsubscribe targets. */
  senderIds: string[];
};

type Mode = 'unsub_only' | 'archive' | 'delete';

const BULK_PREVIEW_CAP = 5;

function senderFuture(name: string, method: string | null | undefined): string | null {
  if (method === 'mailto') return fillCopy(WS5_COPY['f1.preview.future.mailto'], { Sender: name });
  if (method === 'none') return fillCopy(WS5_COPY['f1.preview.future.none'], { Sender: name });
  if (method === 'one_click') return fillCopy(WS5_COPY['f1.preview.future'], { Sender: name });
  return null;
}

/**
 * Three-way unsubscribe confirmation. Archive is the default when the
 * inbox count is above zero. Enter does nothing until the user clicks
 * or tabs, and focus opens on Cancel.
 */
export function UnsubscribeBacklogDialog({
  request,
  compositePreview,
  compositePreviewLoading = false,
  compositePreviewError = false,
  bulkPreview,
  mailboxEmail,
  previewSenderGone = false,
  onRetryPreview,
  onRefreshSenders,
  /** Report fix set: the archive count until the live preview resolves. */
  preferredInboxCount,
  preferredAllMailCount,
  preferredCounts,
  /** Report CTA already says Archive, so the dialog opens on that choice. */
  preferArchive = false,
  submitting = false,
  onCancel,
  onConfirm,
}: {
  request: ActionRequest;
  compositePreview?: CompositeActionPreviewResult | undefined;
  compositePreviewLoading?: boolean | undefined;
  compositePreviewError?: boolean | undefined;
  mailboxEmail?: string | undefined;
  previewSenderGone?: boolean | undefined;
  onRetryPreview?: (() => void) | undefined;
  onRefreshSenders?: (() => void) | undefined;
  bulkPreview?:
    | {
        data?:
          | {
              senders: Array<{
                senderId: string;
                name: string;
                protected: boolean;
                counts: ActionWindowCounts;
                allMailCounts?: ActionWindowCounts;
              }>;
            }
          | undefined;
        loading: boolean;
        error?: boolean | undefined;
      }
    | undefined;
  preferredInboxCount?: number | undefined;
  preferredAllMailCount?: number | undefined;
  preferredCounts?: UnsubscribeSnapshotCounts | undefined;
  preferArchive?: boolean | undefined;
  submitting?: boolean | undefined;
  onCancel: () => void;
  onConfirm: (opts: UnsubscribeBacklogOptions) => void;
}) {
  const single = request.senders.length === 1;
  const recordedUnsubscribeCount = request.skipped?.recordedUnsubscribeCount ?? 0;
  const auth = useOptionalAuth();
  const activeMailboxEmail = mailboxEmail ?? (auth ? getActiveMailboxEmail(auth.me) : null);
  const onlySender = request.senders[0];
  const protectedSingle = single && onlySender?.protectionFlags?.isProtected === true;
  const protectedReason = protectedSingle
    ? normalizeProtectionReason(onlySender?.protectionFlags.protectionReason)
    : null;
  const bulkRows = bulkPreview?.data?.senders.filter((row) => !row.protected) ?? [];
  const inboxSnapshot = (days: number | null) =>
    single
      ? (pickBucketCount(compositePreview?.counts ?? preferredCounts?.inbox, days) ??
        (days === null ? preferredInboxCount : undefined))
      : bulkPreview?.data
        ? sumBucketCounts(
            bulkRows.map((row) => row.counts),
            days,
          )
        : (pickBucketCount(preferredCounts?.inbox, days) ??
          (days === null ? preferredInboxCount : undefined));
  const allMailSnapshot = (days: number | null) =>
    single
      ? (pickBucketCount(compositePreview?.allMail?.counts ?? preferredCounts?.allMail, days) ??
        (days === null ? preferredAllMailCount : undefined))
      : bulkPreview?.data
        ? sumBucketCounts(
            bulkRows.map((row) => row.allMailCounts),
            days,
          )
        : (pickBucketCount(preferredCounts?.allMail, days) ??
          (days === null ? preferredAllMailCount : undefined));
  const snapshotCount = inboxSnapshot(null) ?? null;
  const loading = single ? compositePreviewLoading : (bulkPreview?.loading ?? false);
  const failed = single ? compositePreviewError : (bulkPreview?.error ?? false);
  // Cached counts during a refetch or failed read never arm a cleanup.
  const invalidPreview = loading || failed || previewSenderGone;
  const allInboxCount = invalidPreview ? null : snapshotCount;
  const allReachCount = invalidPreview ? null : (allMailSnapshot(null) ?? null);
  const bulkReady = !single && bulkPreview?.data != null && !loading && !failed;
  const nothingActionable = bulkReady && bulkRows.length === 0;
  const includedIds = new Set(bulkRows.map((row) => row.senderId));
  const includedSenders = bulkReady
    ? request.senders.filter((sender) => includedIds.has(sender.id))
    : request.senders;
  const armed = useRef(false);
  const summary = useCleanupSummary();
  const requestKey = request.senders.map((sender) => sender.id).join(',');
  const countAtOpen = useRef(snapshotCount);
  const requestSeen = useRef(requestKey);
  if (requestSeen.current !== requestKey) {
    requestSeen.current = requestKey;
    countAtOpen.current = snapshotCount;
  }
  const [mode, setMode] = useState<Mode>(() =>
    openingMode(protectedSingle, snapshotCount, preferArchive),
  );
  const [deleteReach, setDeleteReach] = useState<'inbox_only' | 'all_mail'>('inbox_only');
  const [reachRequestKey, setReachRequestKey] = useState(requestKey);
  const [olderThanDays, setOlderThanDays] = useState<number | null>(null);
  const [windowRequestKey, setWindowRequestKey] = useState(requestKey);
  const activeWindow = windowRequestKey === requestKey ? olderThanDays : null;
  const inboxCount = invalidPreview ? null : (inboxSnapshot(activeWindow) ?? null);
  const allMailCount = invalidPreview ? null : (allMailSnapshot(activeWindow) ?? null);
  const offersReach = allInboxCount !== null && allReachCount !== null;
  const activeReach =
    mode === 'delete' && reachRequestKey === requestKey ? deleteReach : 'inbox_only';
  const cleanupCount = activeReach === 'all_mail' ? allMailCount : inboxCount;

  useEffect(() => {
    armed.current = false;
    setDeleteReach('inbox_only');
    setReachRequestKey(requestKey);
    setOlderThanDays(null);
    setWindowRequestKey(requestKey);
    // The count often arrives after the dialog is open. Changing the
    // selected option then moves the primary button under the pointer.
    setMode(openingMode(protectedSingle, countAtOpen.current, preferArchive));
  }, [requestKey, protectedSingle, preferArchive]);

  useEffect(() => {
    if (allInboxCount === null) return;
    const modeDefault: Mode = allInboxCount > 0 ? 'archive' : 'unsub_only';
    void track('unsub_backlog_choice_shown', {
      mode_default: modeDefault,
      sender_count: request.senders.length,
      email_count: allInboxCount,
    });
  }, [requestKey, allInboxCount, request.senders.length]);

  const n = cleanupCount ?? 0;
  const backlogOff = cleanupCount === null || cleanupCount === 0;
  const k = includedSenders.length;
  const singleName =
    request.senders[0]?.name?.trim() || compositePreview?.sender.name?.trim() || '';
  const protectedSkipped = bulkReady
    ? (bulkPreview?.data?.senders.filter(
        (row) => row.protected && request.senders.some((sender) => sender.id === row.senderId),
      ).length ?? 0)
    : 0;
  // A preview that is still loading or failed has not named the mail.
  // Posting from that state would include ids the preview never confirmed.
  // A dialog with no preview at all (a known inbox count, nothing in flight)
  // is separate.
  const previewUnresolved = loading || failed;
  const senderIds = previewUnresolved ? [] : includedSenders.map((sender) => sender.id);
  const includeArchived = mode === 'delete' && activeReach === 'all_mail' && allMailCount !== null;
  const title = nothingActionable
    ? allProtectedSelectionCopy(request.senders.length, singleName)
    : single
      ? unsubscribeTitle(mode, singleName, n)
      : bulkUnsubscribeTitle(mode, k, n);

  const visibleBulk = bulkRows.slice(0, BULK_PREVIEW_CAP);
  const hidden = Math.max(0, bulkRows.length - visibleBulk.length);
  const previewLines: ReactNode[] = [];
  const futureLines = (single ? request.senders.slice(0, 1) : includedSenders)
    .map((sender) =>
      senderFuture(single ? singleName : sender.name.trim(), sender.unsubscribeMethod),
    )
    .filter((line): line is string => line !== null);
  const futureSummary =
    futureLines.length > 0
      ? [...new Set(futureLines)].join(' ')
      : WS5_COPY['f1.preview.future.unchecked'];
  const rowCopy = WS5_COPY['f1.preview.bulkRow'];
  for (const row of visibleBulk) {
    const rowCount = invalidPreview
      ? undefined
      : pickBucketCount(activeReach === 'all_mail' ? row.allMailCounts : row.counts, activeWindow);
    previewLines.push(
      <p key={row.senderId} style={{ margin: 0 }}>
        {isPluralCopy(rowCopy) && rowCount !== undefined
          ? pluralCopy(rowCopy, rowCount, { n: shown(rowCount), Sender: row.name })
          : row.name}
      </p>,
    );
  }
  if (hidden > 0 && isPluralCopy(WS5_COPY['f1.preview.bulkMore'])) {
    previewLines.push(
      <p key="more" style={{ margin: 0 }}>
        {pluralCopy(WS5_COPY['f1.preview.bulkMore'], hidden, { k: hidden })}
      </p>,
    );
  }

  const singleFacts: SheetFactItem[] = [];
  if (single && onlySender) {
    // Inbox Report and the sample Senders screen pass a thin sender
    // (id, name, unsubscribe method). A missing count is not zero.
    const domain = compositePreview?.sender?.domain || onlySender.domain;
    if (typeof domain === 'string' && domain !== '') {
      singleFacts.push({ label: PREVIEW_DETAILS.domain.label, value: domain });
    }
    const received = onlySender.totalReceived;
    if (typeof received === 'number') {
      singleFacts.push({
        label: PREVIEW_DETAILS.sender.label,
        value: fillCopy(WS5_COPY['preview.details.volume'], {
          n: onlySender.monthlyVolume == null ? '—' : shown(onlySender.monthlyVolume),
          total: shown(received),
        }),
      });
    }
    const days = compositePreview?.sender?.lastSeenDays ?? onlySender.lastDays;
    if (typeof days === 'number') {
      singleFacts.push({
        label: PREVIEW_DETAILS.lastSeen.label,
        value: detailLastSeen(days),
      });
    }
    if (mode !== 'unsub_only' && cleanupCount !== null) {
      singleFacts.push({
        label: PREVIEW_DETAILS.includes.label,
        value: previewIncludesValue(includeArchived, activeWindow),
      });
    }
  }
  const note =
    mode === 'delete'
      ? WS5_COPY['f1.honesty.delete']
      : mode === 'archive'
        ? WS5_COPY['f1.honesty.archive']
        : WS5_COPY['f1.honesty.unsubOnly'];
  const button = unsubscribeButton(mode, cleanupCount, protectedSingle);

  const confirm = useCallback(() => {
    if (previewUnresolved) return;
    const secondary = mode === 'unsub_only' ? null : mode;
    void track('unsub_backlog_confirmed', {
      mode,
      sender_count: k,
      email_count: n,
    });
    const includeArchived =
      mode === 'delete' && activeReach === 'all_mail' && allMailCount !== null;
    onConfirm({
      ...(secondary
        ? { secondary: { type: secondary, olderThanDays: activeWindow } }
        : { secondary: null }),
      archiveHistoric: mode === 'archive',
      ...(includeArchived ? { reach: 'all_mail' as const } : {}),
      ...(protectedSingle ? { override: true } : {}),
      senderIds,
    });
  }, [
    mode,
    activeReach,
    activeWindow,
    allMailCount,
    k,
    n,
    protectedSingle,
    onConfirm,
    senderIds,
    previewUnresolved,
  ]);

  // Archive and Delete stay disabled until the backlog count is known.
  // Unsubscribe stays closed while the preview is loading or failed.
  const archivedRequested = mode === 'delete' && activeReach === 'all_mail';
  const confirmDisabled =
    submitting ||
    previewSenderGone ||
    nothingActionable ||
    (mode === 'unsub_only' && previewUnresolved) ||
    (archivedRequested && allMailCount === null) ||
    (mode !== 'unsub_only' && backlogOff);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Tab' || event.key.startsWith('Arrow')) armed.current = true;
      if (event.key !== 'Enter') return;
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        if (!confirmDisabled) confirm();
      } else if (
        !armed.current &&
        !(event.target instanceof HTMLElement && event.target.closest('[data-dm-sheet-cancel]'))
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const onPointer = () => {
      armed.current = true;
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [confirm, confirmDisabled]);
  const { color, radius, space, text } = tokens;
  const status =
    previewSenderGone || nothingActionable ? (
      <>
        {nothingActionable ? null : <span>{WS2_COPY.simplify.senders.gone}</span>}
        {onRefreshSenders ? (
          <Button tone="default" size="sm" onClick={onRefreshSenders}>
            {WS5_COPY['f1.preview.button.refreshSenders']}
          </Button>
        ) : (
          <Link href="/senders" prefetch={false} onClick={onCancel}>
            {WS5_COPY['f1.preview.button.reviewSenders']}
          </Link>
        )}
      </>
    ) : failed ? (
      <>
        <span>
          {!single && mode === 'unsub_only'
            ? WS5_COPY['preview.state.loadFailed.unsub']
            : WS5_COPY['f1.preview.backlog.error']}
        </span>
        {onRetryPreview && (
          <Button tone="default" size="sm" onClick={onRetryPreview}>
            {WS2_COPY.home.failed.retry}
          </Button>
        )}
      </>
    ) : archivedRequested && allMailCount === null && inboxCount !== null ? (
      WS5_COPY['f1.preview.archived.unavailable']
    ) : mode !== 'unsub_only' && cleanupCount === null && !loading ? (
      WS5_COPY['preview.age.rangeUnavailable']
    ) : inboxCount === null ? (
      !single && mode === 'unsub_only' && loading ? (
        WS5_COPY['preview.state.checkingSenders']
      ) : (
        WS5_COPY['f1.preview.backlog.loading']
      )
    ) : mode === 'delete' &&
      n === 0 &&
      offersReach &&
      (allMailCount ?? 0) > 0 &&
      !includeArchived ? (
      DELETE_ARCHIVED_HINT
    ) : mode !== 'unsub_only' && n === 0 ? (
      WS5_COPY['preview.zero.unsubHint']
    ) : null;

  return (
    <div
      onPointerDown={() => {
        armed.current = true;
      }}
    >
      <PreviewSheet
        layout="review"
        onClose={onCancel}
        testId="unsubscribe-backlog-dialog"
        context={
          activeMailboxEmail ? (
            <MailboxActionContextView mailboxEmail={activeMailboxEmail} />
          ) : undefined
        }
        icon={
          single ? (
            <Avatar
              name={singleName}
              {...(onlySender?.domain ? { domain: onlySender.domain } : {})}
              {...(onlySender?.brandMark != null ? { hasMark: onlySender.brandMark } : {})}
              size={64}
            />
          ) : (
            <span
              aria-hidden="true"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 64,
                height: 64,
                borderRadius: radius.lg,
                background: color.fill,
                fontSize: text.xl,
                fontWeight: 600,
              }}
            >
              {shown(k)}
            </span>
          )
        }
        title={title}
        subtitle={<span>{futureSummary}</span>}
        summary={
          <UnsubscribeImpact
            mode={mode}
            count={cleanupCount}
            olderThanDays={activeWindow}
            includesArchived={includeArchived}
            note={note}
          />
        }
        details={
          singleFacts.length > 0 || !single || mode === 'delete' || recordedUnsubscribeCount > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
              {singleFacts.length > 0 && <SheetFactList facts={singleFacts} />}
              {!single && previewLines}
              {recordedUnsubscribeCount > 0 && (
                <span>{WS5_COPY['preview.details.alreadyUnsubscribed']}</span>
              )}
              {mode === 'delete' && <span>{WS5_COPY['f1.deleteNote']}</span>}
            </div>
          ) : undefined
        }
        status={
          status === null ? undefined : (
            <span
              style={{
                display: 'inline-flex',
                flexDirection: 'column',
                gap: space[2],
                alignItems: 'center',
              }}
            >
              {status}
            </span>
          )
        }
        footer={
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
            <span>{WS5_COPY['f1.footer']}</span>
            {mode !== 'unsub_only' && <span>{WS5_COPY['f1.meterFree']}</span>}
            {mode !== 'unsub_only' && summary.data && cleanupCount !== null && (
              <MeterPreviewLine requested={n} summary={summary.data} />
            )}
          </div>
        }
        cancelLabel={WS5_COPY['f1.button.cancel']}
        primary={{
          label: submitting ? WS5_COPY['f1.button.busy'] : button,
          onClick: confirm,
          tone: mode === 'delete' ? 'danger' : 'warn',
          disabled: confirmDisabled,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[3] }}>
          {protectedSingle ? <p>{protectedLead(onlySender?.name ?? '', protectedReason)}</p> : null}
          {protectedSkipped > 0 && includedSenders.length > 0 ? (
            <p>{someProtectedSelectionCopy(protectedSkipped)}</p>
          ) : null}
          <UnsubscribeChoices
            value={mode}
            onChange={(next) => {
              setMode(next);
              setDeleteReach('inbox_only');
              setOlderThanDays(next === 'delete' ? DEFAULT_DELETE_WINDOW_DAYS : null);
              setWindowRequestKey(requestKey);
            }}
            archiveDisabled={allInboxCount === null || allInboxCount === 0}
            deleteDisabled={
              allInboxCount === null || (allInboxCount === 0 && !(allReachCount ?? 0))
            }
          />
          {mode !== 'unsub_only' && (
            <CleanupPreview
              olderThanDays={activeWindow}
              showWindow
              options={TIME_WINDOW_PRESETS.map(({ days }) => ({
                days,
                disabled:
                  !invalidPreview &&
                  (activeReach === 'all_mail' ? allMailSnapshot(days) : inboxSnapshot(days)) ===
                    undefined,
              }))}
              onWindowChange={(next) => {
                setOlderThanDays(next);
                setWindowRequestKey(requestKey);
              }}
            >
              {null}
            </CleanupPreview>
          )}
          {mode === 'delete' && (offersReach || archivedRequested || inboxCount !== null) && (
            <ActionReachControl
              value={activeReach}
              inboxCount={inboxCount}
              allMailCount={allMailCount}
              onChange={(next) => {
                if (next === 'all_mail' && allMailCount === null) return;
                setDeleteReach(next);
                setReachRequestKey(requestKey);
              }}
            />
          )}
        </div>
      </PreviewSheet>
    </div>
  );
}

function shown(n: number): string {
  return n.toLocaleString('en-US');
}

/** `today` is a day count of 0. `one` / `other` are the counted forms. */
function detailLastSeen(days: number): string {
  const copy = WS5_COPY['preview.details.lastSeen'];
  if (days === 0) return copy.today;
  return pluralCopy(copy, days, { n: shown(days) });
}

function openingMode(
  protectedSingle: boolean,
  inboxCount: number | null,
  preferArchive: boolean,
): Mode {
  if (protectedSingle) return 'unsub_only';
  if (preferArchive && inboxCount !== 0) return 'archive';
  if (inboxCount !== null && inboxCount > 0) return 'archive';
  return 'unsub_only';
}

function protectedLead(
  sender: string,
  reason: ReturnType<typeof normalizeProtectionReason>,
): string {
  const clause = protectionReasonClause(reason);
  if (clause === 'it is Protected') {
    return fillCopy(WS5_COPY['f1.protected.leadNoReason'], { Sender: sender });
  }
  return fillCopy(WS5_COPY['f1.protected.lead'], { Sender: sender, reason: clause });
}
