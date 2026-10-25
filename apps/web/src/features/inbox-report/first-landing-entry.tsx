'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { WS5_COPY } from '@declutrmail/shared/copy/launch';
import type { InboxReportDto } from '@declutrmail/shared/inbox-report';
import { activityKeys } from '@/features/activity/api/query-keys';
import { apiGet } from '@/lib/api/client';
import { useConfirmUnsubscribeBacklog } from '@/lib/api/use-action';
import { toastUnsubscribeBacklog, toastUnsubscribeBacklogFailure } from './backlog-outcome';
import { InboxReportPanel } from './panel';
import { isReportDismissed, setReportDismissed } from './seen';

/** Activity's terminal reconciliation refreshes the snapshot. */
function inboxReportQueryKey(mailboxId: string) {
  return [...activityKeys.all, 'inbox-report', mailboxId] as const;
}

export function InboxReportFirstLanding(props: {
  mailboxId: string;
  compact?: boolean;
  mailboxEmail?: string;
  senderNames?: Readonly<Record<string, { name: string }>>;
  onReview?: (senderIds: readonly string[]) => void;
  onResolved(shown: boolean): void;
}): JSX.Element {
  const { mailboxId, mailboxEmail, senderNames, onResolved } = props;
  const confirmBacklog = useConfirmUnsubscribeBacklog();
  const scope = useRef({ mailboxId, generation: 0 });
  if (scope.current.mailboxId !== mailboxId)
    scope.current = { mailboxId, generation: scope.current.generation + 1 };
  const reportQuery = useQuery({
    queryKey: inboxReportQueryKey(mailboxId),
    queryFn: async ({ signal }) => {
      const envelope = await apiGet<InboxReportDto>(`/api/mailboxes/${mailboxId}/inbox-report`, {
        signal,
      });
      return envelope.data;
    },
    staleTime: 30_000,
  });
  const report = reportQuery.data ?? null;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (reportQuery.isSuccess) onResolved(true);
    else if (reportQuery.isError && reportQuery.data === undefined) onResolved(false);
  }, [onResolved, reportQuery.data, reportQuery.isError, reportQuery.isSuccess]);
  useLayoutEffect(() => {
    const syncDismissed = () =>
      setDismissed(window.location.hash === '#inbox-report' ? false : isReportDismissed(mailboxId));
    syncDismissed();
    window.addEventListener('hashchange', syncDismissed);
    return () => window.removeEventListener('hashchange', syncDismissed);
  }, [mailboxId]);
  if (!report)
    return (
      <section id="inbox-report" className="dm-report" aria-label={WS5_COPY['report.eyebrow']}>
        <p role="status">{reportQuery.isError ? WS5_COPY['report.error'] : 'Loading snapshot…'}</p>
        {reportQuery.isError ? (
          <button type="button" onClick={() => void reportQuery.refetch()}>
            Retry report
          </button>
        ) : null}
      </section>
    );
  return (
    <InboxReportPanel
      key={mailboxId}
      report={report}
      compact={props.compact ?? false}
      mailboxId={mailboxId}
      mailboxEmail={mailboxEmail}
      {...(senderNames ? { senderNames } : {})}
      {...(props.onReview ? { onReview: () => props.onReview?.(report.fix.senderKeys) } : {})}
      dismissed={dismissed}
      onDismiss={() => {
        setReportDismissed(mailboxId, true);
        setDismissed(true);
        if (window.location.hash === '#inbox-report')
          window.history.replaceState(
            window.history.state,
            '',
            window.location.pathname + window.location.search,
          );
      }}
      onReopen={() => {
        setReportDismissed(mailboxId, false);
        setDismissed(false);
      }}
      fixPending={confirmBacklog.isPending}
      onFixConfirmed={(mode, reach, senderIds, olderThanDays) => {
        if (confirmBacklog.isPending || senderIds.length === 0) return;
        const generation = scope.current.generation;
        confirmBacklog.mutate(
          {
            mailboxId,
            mode,
            senderIds,
            ...(mode !== 'unsub_only' && olderThanDays != null ? { olderThanDays } : {}),
            ...(mode === 'delete' && reach ? { reach } : {}),
          },
          {
            // Accepted cleanup is tracked by the shared progress/Undo owner.
            // The snapshot never stores an optimistic result or a second Undo.
            onSuccess: (result) => {
              if (scope.current.generation === generation) toastUnsubscribeBacklog(result);
            },
            onError: (error) => {
              if (scope.current.generation === generation) toastUnsubscribeBacklogFailure(error);
            },
          },
        );
      }}
    />
  );
}
