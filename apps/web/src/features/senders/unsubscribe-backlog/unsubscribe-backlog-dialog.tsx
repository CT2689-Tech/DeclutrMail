'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';

import { Avatar, Button, PreviewSheet, SheetSegmented, tokens } from '@declutrmail/shared';
import { normalizeProtectionReason, protectionReasonClause } from '@declutrmail/shared/copy';
import { fillCopy, isPluralCopy, pluralCopy, WS5_COPY } from '@declutrmail/shared/copy/launch';

import { MeterPreviewLine } from '@/features/billing/meter-preview-line';
import { backlogDestination, bulkUnsubscribeTitle, unnamedUnsubscribeTitle } from './preview-copy';
import { useCleanupSummary } from '@/features/billing/use-cleanup-summary';
import { getActiveMailboxEmail, useOptionalAuth } from '@/features/auth/auth-provider';
import { MailboxActionContextView } from '@/features/auth/mailbox-action-context-view';
import { track } from '@/lib/posthog';
import type { CompositeActionPreviewResult } from '@/lib/api/use-action';

import type { ActionRequest } from '../data';
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

  const countKnown = cleanupCount !== null;
  const n = cleanupCount ?? 0;
  const backlogOff = cleanupCount === null || cleanupCount === 0;
  const k = includedSenders.length;
  const singleName =
    request.senders[0]?.name?.trim() || compositePreview?.sender.name?.trim() || '';
  const title = (() => {
    if (nothingActionable) return 'No senders available to unsubscribe';
    // A live count of 0 is a real empty set. Null is still loading, and
    // "archive 0 emails" would be a count we have not read.
    if (!countKnown && mode !== 'unsub_only') {
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
  const methods = new Set(includedSenders.map((sender) => sender.unsubscribeMethod));
  const futureSummary = single
    ? senderFuture(singleName, onlySender?.unsubscribeMethod)
    : [
        methods.has('one_click') ? 'We’ll send one-click unsubscribe requests.' : null,
        methods.has('mailto') ? 'Email requests need you to send from Gmail.' : null,
        methods.has('none') ? 'Senders without a link can’t receive an unsubscribe request.' : null,
      ]
        .filter(Boolean)
        .join(' ');
  const rowCopy = WS5_COPY['f1.preview.bulkRow'];
  for (const row of visibleBulk) {
    const sender = request.senders.find((item) => item.id === row.senderId);
    const future = senderFuture(row.name, sender?.unsubscribeMethod);
    const rowCount = invalidPreview
      ? undefined
      : pickBucketCount(activeReach === 'all_mail' ? row.allMailCounts : row.counts, activeWindow);
    previewLines.push(
      <p key={row.senderId} style={{ margin: 0 }}>
        {future ? `${future} ` : ''}
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

  const note =
    mode === 'delete'
      ? WS5_COPY['f1.honesty.delete']
      : mode === 'archive'
        ? WS5_COPY['f1.honesty.archive']
        : WS5_COPY['f1.honesty.unsubOnly'];
  const button = protectedButton(mode, protectedSingle);

  const confirm = useCallback(() => {
    const secondary = mode === 'unsub_only' ? null : mode;
    void track('unsub_backlog_confirmed', {
      mode,
      sender_count: k,
      email_count: n,
    });
    onConfirm({
      ...(secondary
        ? { secondary: { type: secondary, olderThanDays: activeWindow } }
        : { secondary: null }),
      archiveHistoric: mode === 'archive',
      ...(mode === 'delete' && activeReach === 'all_mail' ? { reach: activeReach } : {}),
      ...(protectedSingle ? { override: true } : {}),
    });
  }, [mode, activeReach, activeWindow, k, n, protectedSingle, onConfirm]);

  // A missing backlog count must not block the future-only request.
  // Archive and Delete stay disabled until that count is known.
  const confirmDisabled =
    submitting || previewSenderGone || nothingActionable || (mode !== 'unsub_only' && backlogOff);
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
        <span>
          {nothingActionable
            ? 'Every selected sender is now Protected or no longer in this mailbox.'
            : 'This sender is no longer in this mailbox.'}
        </span>
        {onRefreshSenders ? (
          <Button tone="default" size="sm" onClick={onRefreshSenders}>
            Refresh senders
          </Button>
        ) : (
          <Link href="/senders" prefetch={false} onClick={onCancel}>
            Review senders
          </Link>
        )}
      </>
    ) : failed ? (
      <>
        <span>Couldn’t load the cleanup preview. Retry to archive or delete existing email.</span>
        {onRetryPreview && (
          <Button tone="default" size="sm" onClick={onRetryPreview}>
            Retry preview
          </Button>
        )}
      </>
    ) : activeReach === 'all_mail' && allMailCount === null && inboxCount !== null ? (
      'The Inbox + archived preview is unavailable. Choose Inbox only.'
    ) : mode !== 'unsub_only' && cleanupCount === null && !loading ? (
      'The cleanup preview for this range is unavailable. Choose another range.'
    ) : inboxCount === null ? (
      'Counting existing inbox email…'
    ) : mode === 'delete' && n === 0 && offersReach && (allMailCount ?? 0) > 0 ? (
      'Switch to Inbox + archived to reach the archived email.'
    ) : mode !== 'unsub_only' && n === 0 ? (
      'No existing email matches this range. Choose another range or Unsubscribe only.'
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
            <span>{futureSummary || 'The unsubscribe method hasn’t been checked yet.'}</span>{' '}
            <span>{backlogDestination(mode, activeReach)}</span>
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
          label: submitting ? 'Submitting…' : button,
          onClick: confirm,
          tone: mode === 'delete' ? 'danger' : 'warn',
          disabled: confirmDisabled,
        }}
      >
        {protectedSingle ? <p>{protectedLead(onlySender?.name ?? '', protectedReason)}</p> : null}
        <SheetSegmented
          label="Existing email"
          value={mode}
          onChange={(next) => {
            setMode(next);
            setDeleteReach('inbox_only');
          }}
          options={[
            { value: 'unsub_only', label: WS5_COPY['f1.segment.unsubOnly'] },
            {
              value: 'archive',
              disabled: allInboxCount === null || allInboxCount === 0,
              label:
                inboxCount === null
                  ? WS5_COPY['f1.segment.archive.loading']
                  : isPluralCopy(archiveLabel)
                    ? pluralCopy(archiveLabel, inboxCount, { n: shown(inboxCount) })
                    : '',
            },
            {
              value: 'delete',
              disabled: allInboxCount === null || (allInboxCount === 0 && !(allReachCount ?? 0)),
              label:
                cleanupCount === null
                  ? WS5_COPY['f1.segment.delete.loading']
                  : isPluralCopy(deleteLabel)
                    ? pluralCopy(deleteLabel, n, { n: shown(n) })
                    : '',
            },
          ]}
        />
        {mode === 'delete' && (offersReach || activeReach === 'all_mail') && (
          <div style={{ marginTop: space[3] }}>
            <SheetSegmented
              label="Where it applies"
              value={activeReach}
              onChange={(next) => {
                setDeleteReach(next);
                setReachRequestKey(requestKey);
              }}
              options={[
                {
                  value: 'inbox_only',
                  label: 'Inbox only',
                  count: inboxCount ?? undefined,
                  disabled: inboxCount === null,
                },
                {
                  value: 'all_mail',
                  label: 'Inbox + archived',
                  count: allMailCount ?? undefined,
                  disabled: allMailCount === null,
                },
              ]}
            />
          </div>
        )}
        {mode !== 'unsub_only' && (
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: space[2],
              marginTop: space[3],
              fontSize: text.sm,
              textAlign: 'left',
            }}
          >
            <span>How far back</span>
            <select
              aria-label="How far back to act on"
              value={activeWindow === null ? 'all' : String(activeWindow)}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setOlderThanDays(value === 'all' ? null : Number(value));
                setWindowRequestKey(requestKey);
              }}
              className="dm-field"
              style={{ ...tokens.field, width: '100%', minWidth: 0 }}
            >
              {TIME_WINDOW_PRESETS.map((preset) => {
                const count = invalidPreview
                  ? undefined
                  : activeReach === 'all_mail'
                    ? allMailSnapshot(preset.days)
                    : inboxSnapshot(preset.days);
                const label =
                  preset.days === null && activeReach === 'all_mail' ? 'All mail' : preset.label;
                return (
                  <option
                    key={preset.days ?? 'all'}
                    value={preset.days ?? 'all'}
                    disabled={count === undefined}
                  >
                    {count === undefined ? `${label} · unavailable` : `${label} · ${shown(count)}`}
                  </option>
                );
              })}
            </select>
          </label>
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
