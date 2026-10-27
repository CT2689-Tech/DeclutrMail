'use client';

import { useEffect, useRef, useState } from 'react';
import { WS5_COPY } from '@declutrmail/shared/copy/launch';
import {
  reportHeadline,
  reportSupport,
  reportWindow,
  type InboxReportDto,
} from '@declutrmail/shared/inbox-report';
import {
  UnsubscribeBacklogDialog,
  type UnsubscribeBacklogOptions,
  type UnsubscribeSnapshotCounts,
} from '@/features/senders/unsubscribe-backlog/unsubscribe-backlog-dialog';
import type { ActionRequest } from '@/features/senders/data';
import { useBulkActionPreview, useCompositePreview } from '@/lib/api/use-action';
import { apiErrorCode } from '@/lib/api/client';
import './report.css';

export function InboxReportPanel({
  report,
  mailboxEmail,
  dismissed = false,
  compact = false,
  onDismiss,
  onReopen,
  onFixConfirmed,
  fixPending = false,
  mailboxId,
  senderNames,
  fixPreviewCounts,
  onReview,
  trustHref = '/settings/privacy',
}: {
  report: InboxReportDto;
  mailboxEmail?: string | undefined;
  dismissed?: boolean;
  compact?: boolean;
  onDismiss: () => void;
  onReopen: () => void;
  onFixConfirmed?: (
    mode: 'archive' | 'delete' | 'unsub_only',
    reach: 'all_mail' | undefined,
    senderIds: string[],
    olderThanDays?: number,
  ) => void;
  /** Synthetic demo buckets; signed-in mailboxes always read a fresh preview. */
  fixPreviewCounts?: UnsubscribeSnapshotCounts;
  fixPending?: boolean;
  onReview?: () => void;
  trustHref?: string;
  mailboxId?: string;
  senderNames?: Readonly<
    Record<string, { name: string; unsubscribeMethod?: 'one_click' | 'mailto' | 'none' | null }>
  >;
}) {
  const [fixOpen, setFixOpen] = useState(false);
  const fixLatch = useRef(false);
  useEffect(() => {
    if (!fixPending) fixLatch.current = false;
  }, [fixPending]);
  const count = report.fix.senderKeys.length;
  const summary =
    count > 0
      ? `${count.toLocaleString('en-US')} ${count === 1 ? 'sender' : 'senders'} worth reviewing.`
      : 'No sender suggestions from this snapshot.';
  return (
    <section
      id="inbox-report"
      className="dm-report"
      aria-label={WS5_COPY['report.eyebrow']}
      data-variant={report.variant}
      data-compact={compact && dismissed ? true : undefined}
    >
      {dismissed ? (
        <div className="dm-report-strip">
          <span>Inbox snapshot</span>
          <button type="button" onClick={onReopen}>
            {compact ? 'View report' : WS5_COPY['report.reopen.button']}
          </button>
        </div>
      ) : (
        <>
          <header className="dm-report-header">
            <h2>Inbox snapshot</h2>
            <ReportSnapshot generatedAt={report.generatedAt} />
            <button
              type="button"
              className="dm-tap-44"
              aria-label={WS5_COPY['report.close.aria']}
              onClick={onDismiss}
            >
              ×
            </button>
          </header>
          <div className="dm-report-summary">
            <p>{summary}</p>
            {count === 0 ? null : onReview ? (
              <button type="button" className="dm-report-primary" onClick={onReview}>
                Review senders
              </button>
            ) : (
              <a className="dm-report-primary" href="/senders">
                Review senders
              </a>
            )}
          </div>
          <details className="dm-report-details">
            <summary>Details</summary>
            <div className="dm-report-detail-content">
              {mailboxEmail ? (
                <p className="dm-report-meta">
                  {report.receivedCount.toLocaleString('en-US')} scanned emails in {mailboxEmail}
                </p>
              ) : (
                <p className="dm-report-meta">
                  {report.receivedCount.toLocaleString('en-US')} scanned emails
                </p>
              )}
              {report.insights.length > 0 ? (
                <ul>
                  {report.insights.map((insight) => (
                    <li key={insight.id}>
                      <p>{reportHeadline(insight).sentence}</p>
                      <p className="dm-report-meta">{reportWindow(insight)}</p>
                      {reportSupport(insight) ? (
                        <p className="dm-report-meta">{reportSupport(insight)}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {count > 0 && onFixConfirmed ? (
                <button
                  type="button"
                  data-report-fix
                  disabled={fixPending}
                  onClick={() => {
                    fixLatch.current = false;
                    setFixOpen(true);
                  }}
                >
                  Preview bulk cleanup
                </button>
              ) : null}
              <a className="dm-report-privacy" href={trustHref}>
                What we store
              </a>
            </div>
          </details>
        </>
      )}
      {fixOpen ? (
        <ReportFixDialog
          report={report}
          senderNames={senderNames}
          mailboxId={mailboxId}
          mailboxEmail={mailboxEmail}
          fixPreviewCounts={fixPreviewCounts}
          onCancel={() => setFixOpen(false)}
          submitting={fixPending}
          onConfirm={(opts) => {
            if (fixPending || fixLatch.current) return;
            fixLatch.current = true;
            setFixOpen(false);
            const mode = opts.secondary?.type ?? 'unsub_only';
            onFixConfirmed?.(
              mode,
              mode === 'delete' ? opts.reach : undefined,
              opts.senderIds,
              opts.secondary?.olderThanDays ?? undefined,
            );
          }}
        />
      ) : null}
    </section>
  );
}

function ReportSnapshot({ generatedAt }: { generatedAt: string }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const date = new Date(generatedAt);
    setLabel(
      Number.isNaN(date.getTime())
        ? null
        : new Intl.DateTimeFormat('en-US', {
            dateStyle: 'medium',
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }).format(date),
    );
  }, [generatedAt]);
  return label ? (
    <p className="dm-report-meta">
      <time dateTime={generatedAt}>{label}</time>
    </p>
  ) : null;
}

function reportFixRequest(
  report: InboxReportDto,
  senderNames: InboxReportPanelProps['senderNames'],
): ActionRequest {
  return {
    verb: 'Unsubscribe',
    senders: report.fix.senderKeys.map((id) => {
      const known = senderNames?.[id];
      return {
        id,
        name: known?.name ?? '',
        ...(known?.unsubscribeMethod ? { unsubscribeMethod: known.unsubscribeMethod } : {}),
      };
    }),
  } as ActionRequest;
}

type FixConfirm = (opts: UnsubscribeBacklogOptions) => void;

function ReportFixDialog({
  report,
  senderNames,
  mailboxId,
  mailboxEmail,
  fixPreviewCounts,
  submitting = false,
  onCancel,
  onConfirm,
}: {
  report: InboxReportDto;
  senderNames: InboxReportPanelProps['senderNames'];
  mailboxId: string | undefined;
  mailboxEmail?: string | undefined;
  fixPreviewCounts?: UnsubscribeSnapshotCounts | undefined;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: FixConfirm;
}) {
  const request = reportFixRequest(report, senderNames);
  if (!mailboxId) {
    return (
      <UnsubscribeBacklogDialog
        request={request}
        mailboxEmail={mailboxEmail}
        preferredInboxCount={report.fix.inboxEmailCount}
        preferredCounts={fixPreviewCounts}
        preferArchive
        submitting={submitting}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );
  }
  return (
    <LiveReportFixDialog
      mailboxId={mailboxId}
      request={request}
      mailboxEmail={mailboxEmail}
      submitting={submitting}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

function LiveReportFixDialog({
  mailboxId,
  mailboxEmail,
  request,
  submitting = false,
  onCancel,
  onConfirm,
}: {
  mailboxId: string;
  mailboxEmail?: string | undefined;
  request: ActionRequest;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: FixConfirm;
}) {
  const ids = request.senders.map((sender) => sender.id);
  const composite = useCompositePreview(ids.length === 1 ? ids[0]! : null, mailboxId);
  const bulk = useBulkActionPreview(ids.length > 1 ? ids : null, mailboxId);
  if (ids.length > 1) {
    return (
      <UnsubscribeBacklogDialog
        request={request}
        mailboxEmail={mailboxEmail}
        bulkPreview={{ data: bulk.data, loading: bulk.isFetching, error: bulk.isError }}
        onRetryPreview={() => {
          void bulk.refetch();
        }}
        preferArchive
        submitting={submitting}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );
  }
  return (
    <UnsubscribeBacklogDialog
      request={request}
      mailboxEmail={mailboxEmail}
      compositePreview={composite.data}
      compositePreviewLoading={composite.isFetching}
      compositePreviewError={composite.isError}
      previewSenderGone={apiErrorCode(composite.error) === 'SENDER_NOT_FOUND'}
      onRetryPreview={() => {
        void composite.refetch();
      }}
      preferArchive
      submitting={submitting}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

type InboxReportPanelProps = Parameters<typeof InboxReportPanel>[0];
