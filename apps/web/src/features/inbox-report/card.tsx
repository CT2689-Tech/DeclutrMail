'use client';

import type { JSX } from 'react';

import { WS5_COPY } from '@declutrmail/shared/copy/launch';

/** Home re-entry for the signed-in Inbox Report. */
export function InboxReportCard(props: { surface: 'home'; mailboxId: string }): JSX.Element | null {
  if (props.surface !== 'home') return null;
  return (
    <a href="/senders" data-mailbox={props.mailboxId}>
      <strong>{WS5_COPY['report.home.title']}</strong>
      <span>{WS5_COPY['report.home.body']}</span>
      <span>{WS5_COPY['report.home.cta']}</span>
    </a>
  );
}
