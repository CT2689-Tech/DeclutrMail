'use client';

import { useEffect, useState } from 'react';
import type { JSX } from 'react';

import type { InboxReportDto } from '@declutrmail/shared/inbox-report';
import { inboxReportEnabled } from './enabled';

import { apiGet } from '@/lib/api/client';

import { InboxReportPanel } from './panel';
import { isReportDismissed, setReportDismissed } from './seen';

/** WS2's FirstLandingSlot renders this on the first ready /senders landing. */
export function InboxReportFirstLanding(props: {
  mailboxId: string;
  onResolved(shown: boolean): void;
}): JSX.Element | null {
  const { mailboxId, onResolved } = props;
  const [report, setReport] = useState<InboxReportDto | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!inboxReportEnabled()) {
      onResolved(false);
      return;
    }
    let cancel = false;
    setDismissed(isReportDismissed(mailboxId));
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
      dismissed={dismissed}
      onDismiss={() => {
        setReportDismissed(mailboxId, true);
        setDismissed(true);
      }}
      onReopen={() => {
        setReportDismissed(mailboxId, false);
        setDismissed(false);
      }}
    />
  );
}
