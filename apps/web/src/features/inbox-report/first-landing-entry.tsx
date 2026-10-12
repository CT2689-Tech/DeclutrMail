'use client';

import { useEffect, useState } from 'react';
import type { JSX } from 'react';

import { toast } from '@declutrmail/shared';
import type { InboxReportDto } from '@declutrmail/shared/inbox-report';

import { getActionFailureCopy } from '@/lib/action-error-copy';
import { apiGet } from '@/lib/api/client';
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
  isReportDismissed,
  readReportCelebration,
  setReportDismissed,
  writeReportCelebration,
  type ReportCelebration,
} from './seen';

/** WS2's FirstLandingSlot renders this on the first ready /senders landing. */
export function InboxReportFirstLanding(props: {
  mailboxId: string;
  mailboxEmail?: string;
  senderNames?: Readonly<Record<string, { name: string }>>;
  onResolved(shown: boolean): void;
}): JSX.Element | null {
  const { mailboxId, mailboxEmail, senderNames, onResolved } = props;
  const confirmBacklog = useConfirmUnsubscribeBacklog();
  const revertUndo = useRevertUndo();
  const [report, setReport] = useState<InboxReportDto | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [celebration, setCelebration] = useState<ReportCelebration | null>(null);
  const [undoHidden, setUndoHidden] = useState(false);
  const undoToken = useCelebrationUndoToken(mailboxId, undoHidden ? null : celebration);

  useEffect(() => {
    let cancel = false;
    setDismissed(isReportDismissed(mailboxId));
    setCelebration(readReportCelebration(mailboxId));
    apiGet<InboxReportDto>(`/api/mailboxes/${mailboxId}/inbox-report`)
      .then((envelope) => {
        if (cancel) return;
        setReport(envelope.data);
        onResolved(true);
      })
      .catch(() => {
        if (cancel) return;
        setFailed(true);
        onResolved(false);
      });
    return () => {
      cancel = true;
    };
  }, [mailboxId, onResolved]);

  useEffect(() => {
    setUndoHidden(false);
  }, [celebration?.actionId]);

  const undoArchive = (token: string) => {
    revertUndo.mutate(
      { token, mailboxId },
      {
        onSuccess: () => setUndoHidden(true),
        onError: (err) => {
          toast(getActionFailureCopy('revert-enqueue', { error: err }), 'warn');
        },
      },
    );
  };

  if (!report || failed) return null;
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
              const next = celebrationFromUnsubscribeBacklog(res);
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
