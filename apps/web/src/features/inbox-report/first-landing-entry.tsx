'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { toast } from '@declutrmail/shared';
import type { InboxReportDto } from '@declutrmail/shared/inbox-report';

import { activityKeys } from '@/features/activity/api/query-keys';
import { refreshAfterUndo } from '@/features/undo/refresh-after-undo';
import { getActionFailureCopy } from '@/lib/action-error-copy';
import { apiGet } from '@/lib/api/client';
import { isTerminalStatus, type UndoRevertResult } from '@/lib/api/actions';
import {
  useActionStatus,
  useBatchStatus,
  useConfirmUnsubscribeBacklog,
  useRevertUndo,
} from '@/lib/api/use-action';

import {
  celebrationFromUnsubscribeBacklog,
  toastUnsubscribeBacklog,
  toastUnsubscribeBacklogFailure,
} from './backlog-outcome';
import { InboxReportPanel } from './panel';
import {
  clearReportCelebration,
  isReportDismissed,
  readReportCelebration,
  REPORT_CELEBRATION_CLEARED,
  reportCelebrationMatchesFix,
  setReportDismissed,
  writeReportCelebration,
  type ReportCelebration,
} from './seen';

/** Under Activity so a confirmed Undo refetches the report with the tray. */
function inboxReportQueryKey(mailboxId: string) {
  return [...activityKeys.all, 'inbox-report', mailboxId] as const;
}

/** WS2's FirstLandingSlot renders this on the first ready /senders landing. */
export function InboxReportFirstLanding(props: {
  mailboxId: string;
  mailboxEmail?: string;
  senderNames?: Readonly<Record<string, { name: string }>>;
  onResolved(shown: boolean): void;
}): JSX.Element | null {
  const { mailboxId, mailboxEmail, senderNames, onResolved } = props;
  const queryClient = useQueryClient();
  const confirmBacklog = useConfirmUnsubscribeBacklog();
  const revertUndo = useRevertUndo();
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
  const [celebration, setCelebration] = useState<ReportCelebration | null>(null);
  const [undoHidden, setUndoHidden] = useState(false);
  const [revertActionId, setRevertActionId] = useState<string | null>(null);
  const undoToken = useCelebrationUndoToken(mailboxId, undoHidden ? null : celebration);
  const undoTokenRef = useRef<string | null>(null);
  undoTokenRef.current = undoToken;
  const releaseRef = useRef<() => void>(() => {});

  releaseRef.current = () => {
    clearReportCelebration(mailboxId);
    setCelebration(null);
    setUndoHidden(true);
    setRevertActionId(null);
    // The undo POST can resolve before the report rebuild. Refresh again
    // until the count settles, or Home and this panel keep the mid-rebuild read.
    void refreshAfterUndo(queryClient, mailboxId);
  };

  useEffect(() => {
    const onCleared = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id !== mailboxId) return;
      setCelebration(null);
      setUndoHidden(true);
    };
    window.addEventListener(REPORT_CELEBRATION_CLEARED, onCleared);
    return () => window.removeEventListener(REPORT_CELEBRATION_CLEARED, onCleared);
  }, [mailboxId]);

  useEffect(() => {
    if (reportQuery.isSuccess) onResolved(true);
    else if (reportQuery.isError && reportQuery.data === undefined) onResolved(false);
  }, [onResolved, reportQuery.data, reportQuery.isError, reportQuery.isSuccess]);

  useLayoutEffect(() => {
    setDismissed(isReportDismissed(mailboxId));
    if (!report) {
      setCelebration(null);
      return;
    }
    const stored = readReportCelebration(mailboxId);
    if (
      stored &&
      !reportCelebrationMatchesFix(stored, {
        senderKeys: report.fix.senderKeys,
        generatedAt: report.generatedAt,
      })
    ) {
      clearReportCelebration(mailboxId);
      setCelebration(null);
      return;
    }
    setCelebration(stored);
  }, [mailboxId, report]);

  useEffect(() => {
    setUndoHidden(false);
  }, [celebration?.actionId]);

  const revertStatus = useActionStatus(revertActionId, mailboxId);
  useEffect(() => {
    if (!revertActionId) return;
    if (revertStatus.isError) {
      setRevertActionId(null);
      return;
    }
    const data = revertStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'done') releaseRef.current();
    else setRevertActionId(null);
  }, [revertActionId, revertStatus.data, revertStatus.isError]);

  useEffect(() => {
    return queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== 'updated' || event.mutation.state.status !== 'success') return;
      const variables = event.mutation.state.variables as { token?: string } | undefined;
      const result = event.mutation.state.data as UndoRevertResult | undefined;
      const token = variables?.token;
      if (!token || token !== undoTokenRef.current || !result) return;
      if (result.reverted) releaseRef.current();
      else if (result.actionId) setRevertActionId(result.actionId);
    });
  }, [queryClient]);

  const watchRevert = (result: UndoRevertResult) => {
    setUndoHidden(true);
    if (result.reverted) releaseRef.current();
    else if (result.actionId) setRevertActionId(result.actionId);
  };

  const undoArchive = (token: string) => {
    revertUndo.mutate(
      { token, mailboxId },
      {
        onSuccess: (result) => watchRevert(result),
        onError: (err) => {
          toast(getActionFailureCopy('revert-enqueue', { error: err }), 'warn');
        },
      },
    );
  };

  if (!report) return null;
  return (
    <InboxReportPanel
      report={report}
      mailboxId={mailboxId}
      mailboxEmail={mailboxEmail}
      {...(senderNames ? { senderNames } : {})}
      dismissed={dismissed}
      celebration={celebration}
      {...(undoToken ? { undoToken, onUndo: () => undoArchive(undoToken) } : {})}
      onDismiss={() => {
        setReportDismissed(mailboxId, true);
        setDismissed(true);
      }}
      onReopen={() => {
        setReportDismissed(mailboxId, false);
        setDismissed(false);
      }}
      onFixConfirmed={(mode) => {
        confirmBacklog.mutate(
          { mailboxId, mode, senderIds: report.fix.senderKeys },
          {
            onSuccess: (res) => {
              toastUnsubscribeBacklog(res);
              const next = celebrationFromUnsubscribeBacklog(res, {
                senderKeys: report.fix.senderKeys,
                generatedAt: report.generatedAt,
              });
              if (next === null) return;
              writeReportCelebration(mailboxId, next);
              setCelebration(next);
            },
            onError: toastUnsubscribeBacklogFailure,
          },
        );
      }}
    />
  );
}

/** Poll the move that this celebration recorded. No token, no button. */
function useCelebrationUndoToken(
  mailboxId: string,
  celebration: ReportCelebration | null,
): string | null {
  const archive =
    celebration != null && celebration.verb !== 'delete' && celebration.verb !== 'unsub_only';
  const id = archive ? (celebration?.actionId ?? null) : null;
  const batch = archive && celebration?.actionHandle === 'batch';
  const action = useActionStatus(batch ? null : id, mailboxId);
  const batchStatus = useBatchStatus(batch ? id : null, mailboxId);
  const snap = batch ? batchStatus.data : action.data;
  if (!snap?.undoToken || snap.undoRevertedAt) return null;
  return snap.undoToken;
}
