'use client';

import { useEffect, useState } from 'react';
import type { JSX } from 'react';

import { toast } from '@declutrmail/shared';
import type { InboxReportDto } from '@declutrmail/shared/inbox-report';

import { getActionFailureCopy } from '@/lib/action-error-copy';
import { ApiError, apiGet } from '@/lib/api/client';
import { useConfirmUnsubscribeBacklog } from '@/lib/api/use-action';
import { unsubscribeBacklogToast } from '@/features/senders/unsubscribe-backlog/toast';

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
  onResolved(shown: boolean): void;
}): JSX.Element | null {
  const { mailboxId, mailboxEmail, onResolved } = props;
  const confirmBacklog = useConfirmUnsubscribeBacklog();
  const [report, setReport] = useState<InboxReportDto | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [celebration, setCelebration] = useState<ReportCelebration | null>(null);

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

  if (!report || failed) return null;
  return (
    <InboxReportPanel
      report={report}
      mailboxId={mailboxId}
      mailboxEmail={mailboxEmail}
      dismissed={dismissed}
      celebration={celebration}
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
              const requested = res.senders.filter(
                (sender) => sender.unsubStatus === 'requested',
              ).length;
              const manual = res.senders.filter((sender) => sender.unsubStatus === 'manual').length;
              const line = unsubscribeBacklogToast(res);
              if (line !== '') toast(line, requested + manual > 0 ? 'info' : 'warn');
              const moved = res.backlog && res.backlog.requestedCount > 0;
              if (moved || requested > 0 || manual > 0) {
                const verb = moved
                  ? res.backlog?.verb === 'delete'
                    ? 'delete'
                    : 'archive'
                  : 'unsub_only';
                const next: ReportCelebration = {
                  archived: res.backlog?.requestedCount ?? 0,
                  senders: requested + manual,
                  verb,
                  requested,
                  manual,
                  ...(verb === 'delete' && typeof res.backlog?.movedBytes === 'number'
                    ? { bytes: res.backlog.movedBytes }
                    : {}),
                };
                writeReportCelebration(mailboxId, next);
                setCelebration(next);
              }
            },
            onError: (err) => {
              if (err instanceof ApiError && err.status === 402) return;
              toast(
                getActionFailureCopy('enqueue', {
                  action: 'Unsubscribe',
                  outcome: 'no request was sent',
                  error: err,
                }),
                'warn',
              );
            },
          },
        );
      }}
    />
  );
}
