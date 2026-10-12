'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { PreviewSheet } from '@declutrmail/shared';
import { normalizeProtectionReason, protectionReasonClause } from '@declutrmail/shared/copy';
import { fillCopy, isPluralCopy, pluralCopy, WS5_COPY } from '@declutrmail/shared/copy/launch';

import { MeterPreviewLine } from '@/features/billing/meter-preview-line';
import styles from './unsubscribe-backlog-dialog.module.css';
import { unnamedUnsubscribeTitle } from './preview-copy';
import { useCleanupSummary } from '@/features/billing/use-cleanup-summary';
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
  bulkPreview,
  /** Report fix set: the archive count until the live preview resolves. */
  preferredInboxCount,
  /** Report CTA already says Archive, so the dialog opens on that choice. */
  preferArchive = false,
  submitting = false,
  onCancel,
  onConfirm,
}: {
  request: ActionRequest;
  compositePreview?: CompositeActionPreviewResult | undefined;
  compositePreviewLoading?: boolean | undefined;
  bulkPreview?:
    | {
        data?:
          | {
              senders: Array<{
                senderId: string;
                name: string;
                protected: boolean;
                counts: { all: number };
              }>;
            }
          | undefined;
        loading: boolean;
      }
    | undefined;
  preferredInboxCount?: number | undefined;
  preferArchive?: boolean | undefined;
  submitting?: boolean | undefined;
  onCancel: () => void;
  onConfirm: (opts: {
    secondary: { type: 'archive' | 'delete'; olderThanDays: null } | null;
    archiveHistoric: boolean;
    /** Set only by the explicit "anyway" click on a Protected sender. */
    override?: boolean;
  }) => void;
}) {
  const single = request.senders.length === 1;
  const onlySender = request.senders[0];
  const protectedSingle = single && onlySender?.protectionFlags?.isProtected === true;
  const protectedReason = protectedSingle
    ? normalizeProtectionReason(onlySender?.protectionFlags.protectionReason)
    : null;
  const bulkRows = bulkPreview?.data?.senders.filter((row) => !row.protected) ?? [];
  const inboxCount = single
    ? (compositePreview?.counts.all ?? preferredInboxCount ?? null)
    : bulkPreview?.data
      ? bulkRows.reduce((sum, row) => sum + row.counts.all, 0)
      : (preferredInboxCount ?? null);
  const loading = single ? compositePreviewLoading : (bulkPreview?.loading ?? false);
  const armed = useRef(false);
  const summary = useCleanupSummary();
  const requestKey = request.senders.map((sender) => sender.id).join(',');
  const countAtOpen = useRef(inboxCount);
  const requestSeen = useRef(requestKey);
  if (requestSeen.current !== requestKey) {
    requestSeen.current = requestKey;
    countAtOpen.current = inboxCount;
  }
  const [mode, setMode] = useState<Mode>(() =>
    openingMode(protectedSingle, inboxCount, preferArchive),
  );

  useEffect(() => {
    armed.current = false;
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

  useEffect(() => {
    const focusCancel = () => {
      const cancel = document.querySelector('[data-dm-sheet-cancel] button');
      if (cancel instanceof HTMLElement) cancel.focus();
    };
    const frame = requestAnimationFrame(focusCancel);
    return () => cancelAnimationFrame(frame);
  }, [requestKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Tab' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        armed.current = true;
        return;
      }
      if (event.key !== 'Enter') return;
      if (!armed.current) {
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
  }, []);

  const countKnown = inboxCount !== null;
  const n = inboxCount ?? 0;
  const backlogOff = inboxCount === null || inboxCount === 0;
  const k = request.senders.length;
  const title = (() => {
    // A live count of 0 is a real empty set. Null is still loading, and
    // "archive 0 emails" would be a count we have not read.
    if (!countKnown && mode !== 'unsub_only') {
      if (!single) return fillCopy(WS5_COPY['f1.title.bulk.unsubOnly'], { k: shown(k) });
      const pendingName = request.senders[0]?.name?.trim() ?? '';
      if (pendingName === '') return unnamedUnsubscribeTitle('unsub_only', 0);
      return fillCopy(WS5_COPY['f1.title.unsubOnly'], { Sender: pendingName });
    }
    if (!single) {
      if (mode === 'delete')
        return fillCopy(WS5_COPY['f1.title.bulk.delete'], { k: shown(k), n: shown(n) });
      if (mode === 'archive')
        return fillCopy(WS5_COPY['f1.title.bulk.archive'], { k: shown(k), n: shown(n) });
      return fillCopy(WS5_COPY['f1.title.bulk.unsubOnly'], { k: shown(k) });
    }
    const Sender = request.senders[0]?.name?.trim() ?? '';
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
  const archiveAria = WS5_COPY['f1.segment.archive.aria'];
  const deleteAria = WS5_COPY['f1.segment.delete.aria'];

  const visibleBulk = bulkRows.slice(0, BULK_PREVIEW_CAP);
  const hidden = Math.max(0, bulkRows.length - visibleBulk.length);
  const previewLines: ReactNode[] = [];
  if (single) {
    const line = senderFuture(
      request.senders[0]?.name ?? '',
      request.senders[0]?.unsubscribeMethod,
    );
    if (line) previewLines.push(<p key="future">{line}</p>);
  } else {
    const rowCopy = WS5_COPY['f1.preview.bulkRow'];
    for (const row of visibleBulk) {
      const sender = request.senders.find((item) => item.id === row.senderId);
      const future = senderFuture(row.name, sender?.unsubscribeMethod);
      previewLines.push(
        <p key={row.senderId}>
          {future ? `${future} ` : ''}
          {isPluralCopy(rowCopy)
            ? pluralCopy(rowCopy, row.counts.all, { n: shown(row.counts.all), Sender: row.name })
            : row.name}
        </p>,
      );
    }
    if (hidden > 0 && isPluralCopy(WS5_COPY['f1.preview.bulkMore'])) {
      previewLines.push(
        <p key="more">{pluralCopy(WS5_COPY['f1.preview.bulkMore'], hidden, { k: hidden })}</p>,
      );
    }
  }
  if (mode === 'archive' && isPluralCopy(WS5_COPY['f1.preview.backlog.archive'])) {
    previewLines.push(
      <p key="backlog">{pluralCopy(WS5_COPY['f1.preview.backlog.archive'], n, { n: shown(n) })}</p>,
    );
  } else if (mode === 'delete' && isPluralCopy(WS5_COPY['f1.preview.backlog.delete'])) {
    previewLines.push(
      <p key="backlog">{pluralCopy(WS5_COPY['f1.preview.backlog.delete'], n, { n: shown(n) })}</p>,
    );
  } else {
    previewLines.push(<p key="stay">{WS5_COPY['f1.preview.backlog.unsubOnly']}</p>);
  }

  const note =
    mode === 'delete'
      ? WS5_COPY['f1.honesty.delete']
      : mode === 'archive'
        ? WS5_COPY['f1.honesty.archive']
        : WS5_COPY['f1.honesty.unsubOnly'];
  const button = protectedButton(mode, protectedSingle);

  const confirm = () => {
    const secondary = mode === 'unsub_only' ? null : mode;
    void track('unsub_backlog_confirmed', {
      mode,
      sender_count: request.senders.length,
      email_count: n,
    });
    onConfirm({
      ...(secondary
        ? { secondary: { type: secondary, olderThanDays: null } }
        : { secondary: null }),
      archiveHistoric: mode === 'archive',
      ...(protectedSingle ? { override: true } : {}),
    });
  };

  // A missing backlog count must not block the future-only request.
  // Archive and Delete stay disabled until that count is known.
  const confirmDisabled = submitting || (mode !== 'unsub_only' && (!countKnown || loading));

  return (
    <div
      onPointerDown={() => {
        armed.current = true;
      }}
    >
      <PreviewSheet
        onClose={onCancel}
        title={title}
        subtitle={<div>{previewLines}</div>}
        note={note}
        footer={
          <p style={{ margin: 0 }}>
            {WS5_COPY['f1.footer']}
            {mode === 'delete' ? ` ${WS5_COPY['f1.deleteNote']}` : ''}
          </p>
        }
        cancelLabel={WS5_COPY['f1.button.cancel']}
        primary={{
          label: button,
          onClick: confirm,
          tone: mode === 'delete' ? 'danger' : 'primary',
          disabled: confirmDisabled,
          ...(submitting ? { busyLabel: button } : {}),
        }}
      >
        {protectedSingle ? <p>{protectedLead(onlySender?.name ?? '', protectedReason)}</p> : null}
        <div role="radiogroup" aria-label={WS5_COPY['f1.segment.unsubOnly']}>
          <Segment
            checked={mode === 'unsub_only'}
            label={WS5_COPY['f1.segment.unsubOnly']}
            onSelect={() => setMode('unsub_only')}
          />
          <Segment
            checked={mode === 'archive'}
            disabled={backlogOff}
            label={
              inboxCount === null
                ? WS5_COPY['f1.segment.archive.loading']
                : isPluralCopy(archiveLabel)
                  ? pluralCopy(archiveLabel, n, { n: shown(n) })
                  : ''
            }
            ariaLabel={
              inboxCount === null
                ? WS5_COPY['f1.segment.archive.loading.aria']
                : isPluralCopy(archiveAria)
                  ? pluralCopy(archiveAria, n, { n: shown(n) })
                  : labelFallback(archiveAria)
            }
            onSelect={() => setMode('archive')}
          />
          <Segment
            checked={mode === 'delete'}
            disabled={backlogOff}
            label={
              inboxCount === null
                ? WS5_COPY['f1.segment.delete.loading']
                : isPluralCopy(deleteLabel)
                  ? pluralCopy(deleteLabel, n, { n: shown(n) })
                  : ''
            }
            ariaLabel={
              inboxCount === null
                ? WS5_COPY['f1.segment.delete.loading.aria']
                : isPluralCopy(deleteAria)
                  ? pluralCopy(deleteAria, n, { n: shown(n) })
                  : ''
            }
            onSelect={() => setMode('delete')}
          />
        </div>
        {mode !== 'unsub_only' ? <p>{WS5_COPY['f1.meterFree']}</p> : null}
        {mode !== 'unsub_only' && summary.data ? (
          <MeterPreviewLine requested={n} summary={summary.data} />
        ) : null}
      </PreviewSheet>
    </div>
  );
}

function Segment({
  checked,
  disabled = false,
  label,
  ariaLabel,
  onSelect,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  ariaLabel?: string;
  onSelect: () => void;
}) {
  return (
    <label className={disabled ? `${styles.segment} ${styles.off}` : styles.segment}>
      <input
        type="radio"
        name="unsubscribe-backlog"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel ?? label}
        onChange={onSelect}
      />
      {label}
    </label>
  );
}

function labelFallback(value: unknown): string {
  return typeof value === 'string' ? value : '';
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
