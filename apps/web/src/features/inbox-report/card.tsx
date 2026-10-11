'use client';

import type { JSX } from 'react';

import { WS5_COPY } from '@declutrmail/shared/copy/launch';
import { isInboxReportEnabled } from '@declutrmail/shared/inbox-report';

/** Home re-entry. Null while the report flag is off. */
export function InboxReportCard(props: { surface: 'home'; mailboxId: string }): JSX.Element | null {
  if (!isInboxReportEnabled()) return null;
  if (props.surface !== 'home') return null;
  return (
    <a href="/senders" data-mailbox={props.mailboxId}>
      <strong>{WS5_COPY['report.home.title']}</strong>
      <span>{WS5_COPY['report.home.body']}</span>
      <span>{WS5_COPY['report.home.cta']}</span>
    </a>
  );
}
