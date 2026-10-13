'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';

import {
  Avatar,
  Button,
  PreviewSheet,
  SheetCheckbox,
  SheetSegmented,
  tokens,
} from '@declutrmail/shared';
import { normalizeProtectionReason, protectionReasonClause } from '@declutrmail/shared/copy';
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
  backlogDestination,
  bulkUnsubscribeTitle,
  someProtectedSelectionCopy,
  unnamedUnsubscribeTitle,
} from './preview-copy';
import { useCleanupSummary } from '@/features/billing/use-cleanup-summary';
import { getActiveMailboxEmail, useOptionalAuth } from '@/features/auth/auth-provider';
import { MailboxActionContextView } from '@/features/auth/mailbox-action-context-view';
import { track } from '@/lib/posthog';
import type { CompositeActionPreviewResult } from '@/lib/api/use-action';

import type { ActionRequest } from '../data';

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
                counts: { all: number };
                allMailCounts?: { all: number };
              }>;
            }
          | undefined;
        loading: boolean;
        error?: boolean | undefined;
      }
    | undefined;
  preferredInboxCount?: number | undefined;
  preferredAllMailCount?: number | undefined;
  preferArchive?: boolean | undefined;
  submitting?: boolean | undefined;
  onCancel: () => void;
  onConfirm: (opts: {
    secondary: { type: 'archive' | 'delete'; olderThanDays: null } | null;
    archiveHistoric: boolean;
    /** Set only by the explicit "anyway" click on a Protected sender. */
    override?: boolean;
    reach?: 'all_mail';
    /** Senders the preview named. Callers post this list and no wider one. */
    senderIds: string[];
  }) => void;
}) {
  const single = request.senders.length === 1;
  const auth = useOptionalAuth();
  const activeMailboxEmail = mailboxEmail ?? (auth ? getActiveMailboxEmail(auth.me) : null);
  const onlySender = request.senders[0];
  const protectedSingle = single && onlySender?.protectionFlags?.isProtected === true;
  const protectedReason = protectedSingle
    ? normalizeProtectionReason(onlySender?.protectionFlags.protectionReason)
    : null;
  const bulkRows = bulkPreview?.data?.senders.filter((row) => !row.protected) ?? [];
  const snapshotCount = single
    ? (compositePreview?.counts.all ?? preferredInboxCount ?? null)
    : bulkPreview?.data
      ? bulkRows.reduce((sum, row) => sum + row.counts.all, 0)
      : (preferredInboxCount ?? null);
  const loading = single ? compositePreviewLoading : (bulkPreview?.loading ?? false);
  const failed = single ? compositePreviewError : (bulkPreview?.error ?? false);
  // Cached counts during a refetch or failed read never arm a cleanup.
  const inboxCount = loading || failed || previewSenderGone ? null : snapshotCount;
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
  const allMailSnapshot = single
    ? (compositePreview?.allMail?.counts.all ?? preferredAllMailCount ?? null)
    : bulkReady && bulkRows.every((row) => row.allMailCounts != null)
      ? bulkRows.reduce((sum, row) => sum + row.allMailCounts!.all, 0)
      : null;
  const allMailCount = loading || failed || previewSenderGone ? null : allMailSnapshot;
  const offersReach = inboxCount !== null && allMailCount !== null;
  const activeReach =
    mode === 'delete' && reachRequestKey === requestKey ? deleteReach : 'inbox_only';
  const cleanupCount = activeReach === 'all_mail' ? allMailCount : inboxCount;

  useEffect(() => {
    armed.current = false;
    setDeleteReach('inbox_only');
    setReachRequestKey(requestKey);
    // The count often arrives after the dialog is open. Changing the
    // selected option then moves the primary button under the pointer.
    setMode(openingMode(protectedSingle, countAtOpen.current, preferArchive));
  }, [requestKey, protectedSingle, preferArchive]);

  useEffect(() => {
    if (inboxCount === null) return;
    const modeDefault: Mode = inboxCount > 0 ? 'archive' : 'unsub_only';
    void track('unsub_backlog_choice_shown', {
      mode_default: modeDefault,
      sender_count: request.senders.length,
      email_count: inboxCount,
    });
  }, [requestKey, inboxCount, request.senders.length]);

  const countKnown = cleanupCount !== null;
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
  // A bulk preview that is still loading or failed has not named who is
  // included. Posting request.senders from that state would include
  // Protected senders and ids the preview never confirmed.
  const senderIds = !single && !bulkReady ? [] : includedSenders.map((sender) => sender.id);
  const includeArchived = mode === 'delete' && activeReach === 'all_mail' && allMailCount !== null;
  const zeroDeleteInbox =
    mode === 'delete' &&
    countKnown &&
    n === 0 &&
    offersReach &&
    allMailCount !== null &&
    allMailCount > 0 &&
    !includeArchived;
  const title = (() => {
    if (nothingActionable) {
      return allProtectedSelectionCopy(
        request.senders.length,
        request.senders[0]?.name?.trim() || '',
      );
    }
    // A live count of 0 is a real empty set. Null is still loading, and
    // "archive 0 emails" would be a count we have not read. Inbox 0 with
    // archived mail still waiting on the checkbox is the same: no delete
    // clause until that mail is actually included.
    if (zeroDeleteInbox || (!countKnown && mode !== 'unsub_only')) {
      if (!single) return bulkUnsubscribeTitle('unsub_only', k, 0);
      if (singleName === '') return unnamedUnsubscribeTitle('unsub_only', 0);
      return fillCopy(WS5_COPY['f1.title.unsubOnly'], { Sender: singleName });
    }
    if (!single) return bulkUnsubscribeTitle(mode, k, n);
    const Sender = singleName;
    if (Sender === '') return unnamedUnsubscribeTitle(mode, n);
    if (mode === 'delete') {
      const forms = WS5_COPY['f1.title.delete'];
      return isPluralCopy(forms) ? pluralCopy(forms, n, { n: shown(n), Sender }) : '';
    }
    if (mode === 'archive') {
      const forms = WS5_COPY['f1.title.archive'];
      return isPluralCopy(forms) ? pluralCopy(forms, n, { n: shown(n), Sender }) : '';
    }
    return fillCopy(WS5_COPY['f1.title.unsubOnly'], { Sender });
  })();

  const archiveLabel = WS5_COPY['f1.segment.archive'];
  const deleteLabel = WS5_COPY['f1.segment.delete'];

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
    const rowCount = activeReach === 'all_mail' ? (row.allMailCounts?.all ?? null) : row.counts.all;
    previewLines.push(
      <p key={row.senderId} style={{ margin: 0 }}>
        {isPluralCopy(rowCopy) && rowCount !== null
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

  const note =
    mode === 'delete'
      ? WS5_COPY['f1.honesty.delete']
      : mode === 'archive'
        ? WS5_COPY['f1.honesty.archive']
        : WS5_COPY['f1.honesty.unsubOnly'];
  const button = protectedButton(mode, protectedSingle);

  const confirm = useCallback(() => {
    if (!single && !bulkReady) return;
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
        ? { secondary: { type: secondary, olderThanDays: null } }
        : { secondary: null }),
      archiveHistoric: mode === 'archive',
      ...(includeArchived ? { reach: 'all_mail' as const } : {}),
      ...(protectedSingle ? { override: true } : {}),
      senderIds,
    });
  }, [
    mode,
    activeReach,
    allMailCount,
    k,
    n,
    protectedSingle,
    onConfirm,
    senderIds,
    single,
    bulkReady,
  ]);

  // A missing backlog count must not block a single sender's future-only
  // request. Bulk Unsubscribe stays closed until the preview names who is
  // included. Archive and Delete stay disabled until that count is known.
  const archivedRequested = mode === 'delete' && activeReach === 'all_mail';
  const confirmDisabled =
    submitting ||
    previewSenderGone ||
    nothingActionable ||
    (!single && !bulkReady) ||
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
        <span>{WS5_COPY['f1.preview.backlog.error']}</span>
        {onRetryPreview && (
          <Button tone="default" size="sm" onClick={onRetryPreview}>
            {WS2_COPY.home.failed.retry}
          </Button>
        )}
      </>
    ) : archivedRequested && allMailCount === null && inboxCount !== null ? (
      WS5_COPY['f1.preview.archived.unavailable']
    ) : inboxCount === null ? (
      WS5_COPY['f1.preview.backlog.loading']
    ) : mode === 'delete' && n === 0 && offersReach && allMailCount > 0 && !includeArchived ? (
      WS5_COPY['f1.preview.archived.hint']
    ) : mode !== 'unsub_only' && n === 0 ? (
      WS5_COPY['f1.preview.backlog.none']
    ) : null;

  return (
    <div
      onPointerDown={() => {
        armed.current = true;
      }}
    >
      <PreviewSheet
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
        subtitle={
          <>
            <span>{futureSummary}</span>
            {zeroDeleteInbox ? null : (
              <>
                {' '}
                <span>{backlogDestination(mode, mode === 'unsub_only' ? null : cleanupCount)}</span>
              </>
            )}
          </>
        }
        note={note}
        details={
          !single || mode === 'delete' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
              {!single && previewLines}
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
        {protectedSingle ? <p>{protectedLead(onlySender?.name ?? '', protectedReason)}</p> : null}
        {protectedSkipped > 0 && includedSenders.length > 0 ? (
          <p>{someProtectedSelectionCopy(protectedSkipped)}</p>
        ) : null}
        <SheetSegmented
          label={WS5_COPY['f1.preview.existing.label']}
          value={mode}
          onChange={(next) => {
            setMode(next);
            setDeleteReach('inbox_only');
          }}
          options={[
            { value: 'unsub_only', label: WS5_COPY['f1.segment.unsubOnly'] },
            {
              value: 'archive',
              disabled: inboxCount === null || inboxCount === 0,
              label:
                inboxCount === null
                  ? WS5_COPY['f1.segment.archive.loading']
                  : isPluralCopy(archiveLabel)
                    ? pluralCopy(archiveLabel, inboxCount, { n: shown(inboxCount) })
                    : '',
            },
            {
              value: 'delete',
              disabled: inboxCount === null || (inboxCount === 0 && !(allMailCount ?? 0)),
              label:
                cleanupCount === null
                  ? WS5_COPY['f1.segment.delete.loading']
                  : isPluralCopy(deleteLabel)
                    ? pluralCopy(deleteLabel, n, { n: shown(n) })
                    : '',
            },
          ]}
        />
        {mode === 'delete' && (offersReach || archivedRequested || inboxCount !== null) && (
          <div style={{ marginTop: space[3] }}>
            <SheetCheckbox
              label={WS2_COPY.simplify.confirm.includeArchived}
              checked={archivedRequested}
              disabled={allMailCount === null && !archivedRequested}
              onChange={(next) => {
                if (next && allMailCount === null) return;
                setDeleteReach(next ? 'all_mail' : 'inbox_only');
                setReachRequestKey(requestKey);
              }}
            />
          </div>
        )}
      </PreviewSheet>
    </div>
  );
}

function shown(n: number): string {
  return n.toLocaleString('en-US');
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

function protectedButton(mode: Mode, protectedSingle: boolean): string {
  if (mode === 'delete') {
    return protectedSingle ? WS5_COPY['f1.button.delete.protected'] : WS5_COPY['f1.button.delete'];
  }
  if (mode === 'archive') {
    return protectedSingle
      ? WS5_COPY['f1.button.archive.protected']
      : WS5_COPY['f1.button.archive'];
  }
  return protectedSingle
    ? WS5_COPY['f1.button.unsubOnly.protected']
    : WS5_COPY['f1.button.unsubOnly'];
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
